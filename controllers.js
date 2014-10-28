'use strict';
const DEBUG = !!process.env.PORTAL_DEBUG,
	fiber = require('carbonfibers'),
	ObjectId = fiber.mongo.ObjectID,
	fs = fiber.fs,
	slice = Array.prototype.slice,
	hasOwn = Object.prototype.hasOwnProperty,
	toString = Object.prototype.toString,
	ServerError = require('./errors').ServerError,
	baseController = {
		namespace: '',
		mixins: ['base'],
		models: [],
		methods: []
	};
function dummy(object) {
	const dummy = Object.create(object);
	let method = '';
	for (method in object) {
		const meth = method;
		if ('function' === typeof object[meth]) {
			dummy[meth] = function () {
				var promise = fiber();
				setTimeout(function () {
					if (meth === 'find') {
						promise.fulfill(null, []);
					} else if (meth === 'mget') {
						promise.fulfill(null, []);
					} else {
						promise.fulfill(null);
					}
				});
				return promise;
			};
		}
	}
	return dummy;
}
function isModuleNotFound(error) {
	if (!error || error.code !== 'MODULE_NOT_FOUND') { throw error; }
}
module.exports = function(pkg) {
	function lookupController(directory, name) {
		try {
			return require(directory + name.replace(/\./g, '/') + '.controller.js');
		} catch (error) {
			isModuleNotFound(error);
		}
	}
	function Method(methods) {
		let index = 0;
		var debugMethods = slice.call(methods);
		while (index < methods.length) {
			const method = methods[index];
			if(Array.isArray(method)) { methods[index] = validate.call(this, method, true); }
			else if('string' === typeof method) {
				methods[index] = this.methods[method];
				if(!(methods[index] instanceof Function)) {
					throw new Error('METOD NOT FOUND: ' + method + '\n' + this.namespace);
				}
			} else if(!(method instanceof Function)) {
				throw new Error('INVALID METHOD TYPE: ' + (typeof method) + '\n' + this.namespace);
			}
			index += 1;
		}
		return function () {
			let results = slice.call(arguments),
				index = 0;
			while (index < methods.length) {
				results = methods[index].apply(this, results);
				if (DEBUG && (!Array.isArray(results)
					&& '[object Arguments]' !== toString.call(results))) {
						throw new Error('Controller Does Not Return An Array of args. \n' + results + toString.call(results));
				}
				index += 1;
			}
			return results;
		};
	}
	Controller.prototype.__proto__ = pkg;
	function Controller(options) {
		if (!(this instanceof Controller)) { return new Controller(options); }
		const mixins = [];
		function findMixins(options) {
			if ('string' === typeof options) {
				options = lookupController(pkg.dirname + '/controllers/', options)
					|| lookupController(pkg.server.dirname + '/controllers/', options)
					|| lookupController(__dirname + '/controllers/', options);
				if (!options) { throw new Error('Mixin Not Found: ' + pkg.name + '/' + options); }
			}
			if (Array.isArray(options.mixins)) {
				options.mixins.forEach(function (mixin) {
					findMixins(mixin);
				});
			}
			mixins.push(options);
		}
		findMixins(options);
		mixins.forEach(function (options) {
			Object.keys(options).forEach(function (propertyName) {
				this[propertyName] = options[propertyName];
			}.bind(this));
		}.bind(this));
		this.collection = this.collection || this.namespace.replace(/^\/|\/$/g, '').replace(/\//g, '_');
		this.server = pkg.server;
		this.package = pkg;
		this.models = Object.create(null);
		this.methods = Object.create(null);
		this.api = Object.create(null);
		if(options === baseController) {
			this.__proto__ = pkg;
		} else {
			if ('string' === typeof options.inherits) {
				const controllerOptions = lookupController(pkg.dirname + '/controllers/', options.inherits)
					|| lookupController(pkg.server.dirname + '/controllers/', options.inherits)
					|| lookupController(__dirname + '/controllers/', options.inherits);
				if (!controllerOptions) { throw new Error('Mixin Not Found: ' + pkg.name + '/' + options.inherits); }
				this.__proto__ = new Controller(controllerOptions);
			} else {
				this.__proto__ = new Controller(options.inherits || baseController);
			}
			this.models.__proto__ = this.__proto__.models;
			this.methods.__proto__ = this.__proto__.methods;
			this.api.__proto__ = this.__proto__.api;
		}
		mixins.forEach(function (options) {
			Object.keys(options.models || {}).forEach(function (modelName) {
				this.models[modelName] = options.models[modelName];
				this['model' + (modelName.substring(0,1)+'').toUpperCase() + modelName.substring(1)] = options.models[modelName];
			}.bind(this));
			Object.keys(options.methods || {}).forEach(function (methodName) {
				// const method = options.methods[methodName];
				// this.methods[methodName] = ((method instanceof Function) ? method :
					// Method.bind(this)(Array.isArray(method) ? method : [method]));
				const method = options.methods[methodName];
				this.methods[methodName] = (Method.bind(this)(Array.isArray(method) ? method : [method]));
				this['method' + (methodName.substring(0,1)+'').toUpperCase() + methodName.substring(1)] = method;
			}.bind(this));
			Object.keys(options.api || {}).forEach(function (methodName) {
				const method = options.api[methodName];
				this.api[methodName] = Method.bind(this)(Array.isArray(method) ? method : [method], true);
				this['api' + (methodName.substring(0,1)+'').toUpperCase() + methodName.substring(1)] = method;
			}.bind(this));
			if (hasOwn.call(options, 'constructor') && options.constructor instanceof Function && options.constructor !== Object) {
				options.constructor.call(this, options);
			}
		}.bind(this));
		if (this.initialization) {
			//TODO: make inheritable:
			this.initialization();
		}
		this.server.tests.push(fiber(function(callback) {
			let method = '',
				testInstance = Object.create(this);
			testInstance.session = { user: {}, permissions: {}, };
			testInstance.permits = function () { return true; };
			if (this.package.mongo) {
				testInstance.mongo = {
					get: function (collectionName) {
						return dummy(this.package.mongo.get(collectionName));
					}.bind(this),
					oid: this.package.mongo.oid,
				};
			}
			testInstance.redis = dummy(testInstance.redis);
			for (method in this.api) {
				try{
					output.apply(testInstance, (this.api[method].apply(testInstance, input([]))));
				} catch(error) {
					if (!(error instanceof ServerError)) {
						console.log('TEST FAIL:', pkg.name, this.namespace, method);
						throw error;
					}
				}
			}
		}.bind(this)).fork());
	}
	function input(object) {
		var i, key, copy, array;
		if (object && ('object' === typeof object)) {
			if (object instanceof ObjectId) {
				return '' + object;
			}
			if (Array.isArray(object)) {
				array = [];
				i = 0;
				while (i < object.length) {
					array[i] = input(object[i]);
					i += 1;
				}
				return array;
			}
			copy = {};
			key = '';
			for (key in object) {
				if (hasOwn.call(object, key) && !/^_/.test(key)) {
					copy[key] = input(object[key]);
				}
			}
			return copy;
		}
		return object;
	}
	baseController.models.input = input;
	function output(object) {
		var i, key, copy, array;
		if (object && ('object' === typeof object)) {
			if (object instanceof ObjectId) {
				return '' + object;
			}
			if (Array.isArray(object)) {
				array = [];
				i = 0;
				while (i < object.length) {
					array[i] = output(object[i]);
					i += 1;
				}
				return array;
			}
			copy = {};
			key = '';
			for (key in object) {
				if ((hasOwn.call(object, key) && !/^__|\./.test(key))) {
					copy[key] = output(object[key]);
				}
			}
			return copy;
		}
		return object;
	}
	baseController.models.output = output;
	function validate(models, sequence) {
		function recursive(model) {
			if ('string' === typeof model) {
				if(!(this.models[model] instanceof Function)) {
					throw new Error('MODEL NOT FOUND: ' + model + '\n' + this.namespace);
				}
				return this.models[model];
			} else if (Array.isArray(model)) {
				model = recursive.call(this, model[0]);
				return function (array, args, index) {
					if (!Array.isArray(array)) {
						throw new ClientError('error:validation:array');
					}
					const length = array.length;
					let arrayIndex = 0; while (arrayIndex < length) {
						array[arrayIndex] = model.call(this, array[arrayIndex], args, index);
						index += 1;
					}
					return array;
				}
			} else if (model && model.constructor === Object) {
				model = Object.create(model);
				Object.keys(model.__proto__).forEach(function (key) {
					model[key] = recursive.call(this, model[key]);
				});
				return function (object, args, index) {
					if (!object || object.constructor !== Object) {
						throw new ClientError('error:validation:object');
					}
					let key; for (key in object) {
						if (hasOwn.call(model, key)) {
							object[key] = model[key].call(this, object[key], args, index);
						}
					}
					return object;
				}
			} else {
				throw new Error('Unknown model in controller api: ' + model);
			}
		}
		models = models.map(recursive.bind(this));
		return function () {
			const args = slice.call(arguments);
			let index = 0;
			while (index < models.length) {
				args[index] = models[index].call(this, args[index], args, index);
				index += 1;
			}
			return args;
		}
	}
	fs.readdirc(pkg.paths.controllers).wait()
		.filter(function (filename) {
			return /\.controller\.js$/.test(filename);
		})
		.forEach(function (fileName) {
			const controllerName = fileName.substring(pkg.paths.controllers.length),
				options = require(fileName);
			if(!options.namespace) { options.namespace = ('/' + controllerName + '/').replace(/^\/*|\/+$/g, '/'); }
			this.controllers[options.namespace] = Controller(options);
			//*useful*/ console.log(pkg.name + ':' + controllerName + ' loaded for namespace ' + options.namespace);
		}.bind(pkg));
}
