'use strict';
const DEBUG = !!process.env.PORTAL_DEBUG,
	PORTAL_DEBUG_CONTROLLERS = !!process.env.PORTAL_DEBUG_CONTROLLERS,
	fiber = require('carbonfibers'),
	ObjectId = fiber.mongo.ObjectID,
	fs = fiber.fs,
	slice = Array.prototype.slice,
	hasOwn = Object.prototype.hasOwnProperty,
	toString = Object.prototype.toString,
	ServerError = require('./errors').ServerError,
	colorBold = '\x1B[1m',
	colorGrey = '\x1B[90m',
	colorRed = '\x1B[31m',
	colorYellow = '\x1B[33m',
	colorWhite = '\x1B[37m',
	colorGreen = '\x1B[32m',
	colorCyan = '\x1B[1m\x1B[36m',
	colorReset = '\x1B[0m';
function Name(string) {
	return (('' + (string || '')).toLowerCase().replace(/[^a-z0-9]/g, ''));
}
function PathName(string) {
	return (('' + (string || '')).toLowerCase().replace(/[^a-z0-9\/]/g, '').replace(/\/+/g, '/'));
}
function allKeys(object) {
	const keys = [];
	for (let key in object) {
		// get all keys, not just top level prototype with hasOwnProperty
		keys.push(key);
	}
	return keys;
}
function sequence(next, fn) {
	function sequence() {
		return fn.apply(this,
			(next ?
				slice.call(next.apply(this, arguments)) :
				arguments));
	}
	return sequence;
}
function ModelApplier(functions) {
	function applier() {
		const args = slice.call(arguments),
			length = functions.length;
		let index = 0; while (index < length) {
			args[index] = functions[index].call(this, args[index]);
			index += 1;
		}
		return args;
	}
	return applier;
}
function Model(name, models, functions) {
	let signature = [];
	function lookupModel(model) {
		if (model instanceof Function) {
			signature.push('fn');
			return model;
		}
		signature.push('"' + colorCyan + model + colorReset + '"');
		if (typeof model === 'string') {
			if (!models[Name(model)]) {
				throw new Error(name + ' -> ' + signature.join(' -> ') + 'not found in\n{ ' + allKeys(models).join(', ') + ' }');
			}
			let modelSequence = Model(name + ' -> ' + signature.join(' -> '), models, models[Name(model)]);
			signature.push(modelSequence.signature);
			return modelSequence;
		}
		console.log(model)
		throw new Error(name + ' -> ' + signature.join(' -> ') + 'not a function, or model name string');
	}
	const sequenceFn = ((Array.isArray(functions) ? functions : [functions])
		.map(lookupModel)
		.reduce(sequence));
	sequenceFn.signature = '(' + signature.join(' -> ') + ')';
	return sequenceFn;
}
function Method(name, methods, models, functions) {
	let signature = [];
	function lookupMethod(method) {
		if (method instanceof Function) {
			signature.push('fn');
			return method;
		}
		if (Array.isArray(method)) {
			const modelFunctions = method.map(Model.bind(this, name + ' -> ' + signature.join(' -> '), models)),
				modelApplier = ModelApplier(modelFunctions);
			modelApplier.signature = '[ ' + modelFunctions.map(function (fn) { return fn.signature; }).join(', ') + ' ]';
			signature.push(modelApplier.signature);
			return modelApplier;
		}
		signature.push('"' + colorCyan + method + colorReset + '"');
		if (typeof method === 'string') {
			if (!methods[Name(method)]) {
				throw new Error(name + ' -> ' + signature.join(' -> ') + 'not found in\n{ ' + allKeys(methods).join(', ') + ' }');
			}
			let methodSequence = Method(name + ' -> ' + signature.join(' -> '), methods, models, methods[Name(method)]);
			signature.push(methodSequence.signature);
			return methodSequence;
		}
		throw new Error(name + ' -> ' + signature.join(' -> ') + 'not a function, models array, or method name string');
	}
	const sequenceFn = ((Array.isArray(functions) ? functions : [functions])
		.map(lookupMethod)
		.reduce(sequence));
	sequenceFn.signature = '(' + signature.join(' -> ') + ')';
	return sequenceFn;
}
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
	var baseController = {
		mixins: ['base'],
		models: {
			Object: Object,
			Array: Function.prototype.call.bind(Array.prototype.slice),
			String: String,
			Boolean: Boolean
		}
	};
	function lookupController(directory, name) {
		try {
			return require(directory + name.replace(/\./g, '/') + '.controller');
		} catch (error) {
			isModuleNotFound(error);
		}
	}
	Controller.prototype.__proto__ = pkg;
	function Controller(options) {
		if (!(this instanceof Controller)) { return new Controller(options); }
		const mixins = [],
			self = this;
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
			} else if (options.mixins) {
				findMixins(options.mixins);
			}
			mixins.push(options);
		}
		findMixins(options);
		mixins.forEach(function (options) {
			Object.keys(options).forEach(function (propertyName) {
				self[propertyName] = options[propertyName];
			}.bind(self));
		}.bind(self));
		self.collection = self.collection || self.namespace.replace(/^\/|\/$/g, '').replace(/\//g, '_');
		self.server = pkg.server;
		self.package = pkg;
		self.models = Object.create(null);
		self.methods = Object.create(null);
		self.api = Object.create(null);
		if (options === baseController) {
			self.__proto__ = pkg;
		} else {
			if ('string' === typeof options.inherits) {
				const controllerOptions = lookupController(pkg.dirname + '/controllers/', options.inherits)
					|| lookupController(pkg.server.dirname + '/controllers/', options.inherits)
					|| lookupController(__dirname + '/controllers/', options.inherits);
				if (!controllerOptions) { throw new Error('Mixin Not Found: ' + pkg.name + '/' + options.inherits); }
				self.__proto__ = new Controller(controllerOptions);
			} else {
				self.__proto__ = new Controller(options.inherits || baseController);
			}
			self.models.__proto__ = self.__proto__.models;
			self.methods.__proto__ = self.__proto__.methods;
			self.api.__proto__ = self.__proto__.api;
		}
		mixins.forEach(function (options) {
			Object.keys(options.models || {}).forEach(function (modelName) {
				self.models[Name(modelName)] = self.models[modelName] = options.models[modelName];
			});
			Object.keys(options.methods || {}).forEach(function (methodName) {
				self.methods[Name(methodName)] = self.methods[methodName] = options.methods[methodName];
			});
			Object.keys(options.api || {}).forEach(function (apiName) {
				self.api[PathName(apiName)] = options.api[apiName];
			});
		});
		Object.keys(self.models).forEach(function (modelName) {
			self.models[modelName] = Model(self.package.name + ' ' + self.namespace + ' models{} -> ' + modelName + ' -> ', self.models, self.models[modelName]);
		});
		Object.keys(self.methods).forEach(function (methodName) {
			self.methods[methodName] = Method(self.package.name + ' ' + self.namespace + ' methods{} -> ' + methodName + ' -> ', self.methods, self.models, self.methods[methodName]);
		});
		Object.keys(self.api).forEach(function (apiName) {
			self.api[apiName] = Method(self.package.name + ' ' + self.namespace + ' api{} -> ' + apiName + ' -> ', self.methods, self.models, self.api[apiName]);
		});
		mixins.forEach(function (options) {
			if (hasOwn.call(options, 'constructor') && options.constructor instanceof Function && options.constructor !== Object) {
				options.constructor.call(self, options);
			}
		});
		if (this.initialization) {
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
				try {
					output.apply(testInstance, (this.api[method].apply(testInstance, input([]))));
				} catch(error) {
					if (!(error instanceof ServerError)) {
						/*useful*/ console.log('TEST FAIL:', pkg.name, this.namespace, method, ' -> ', (this.api[method]||{}).signature, '\n' + colorRed, error, error.stack, colorReset);
						// console.log('TEST FAIL:', pkg.name, this.namespace, method, error, error.stack);
						throw error;
					}
				}
			}
		}.bind(this)).fork());
	}
	Controller.prototype.get = get;
	function get(name) {
		const
			path = PathName(name);
		name = Name(name);
		return (
			this.api[path] ||
			this.methods[name] ||
			this.models[name] ||
			this[name] ||
			function () {}).bind(this);
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
	fs.readdirc(pkg.paths.controllers).wait()
		.filter(function (filename) {
			return /\.controller\.\w+$/.test(filename);
		})
		.forEach(function (fileName) {
			const controllerName = fileName.substring(pkg.paths.controllers.length).replace(/\.controller\.\w+$/, ''),
				options = require(fileName);
			if(!options.namespace) { options.namespace = ('/' + controllerName + '/').replace(/^\/*|\/+$/g, '/'); }
			this.controllers[options.namespace] = Controller(options);
			if (PORTAL_DEBUG_CONTROLLERS) {
				/*useful*/ console.log(pkg.name + ':' + controllerName + ' loaded for namespace ' + options.namespace + '\n\t(' + colorYellow + Object.keys(this.controllers[options.namespace].api).join(colorReset + ', ' + colorYellow) + colorReset + ')');
			}
		}.bind(pkg));
}
module.exports.Name = Name;
module.exports.PathName = PathName;
