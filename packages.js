'use strict';
const fiber = require('carbonfibers'),
	fs = fiber.fs,
	ejs = fiber.ejs,
	errors = require('./errors'),
	dns = require('dns'),
	files = require('./files'),
	ses = require('./ses'),
	controllers = require('./controllers'),
	PathName = controllers.PathName,
	ServerError = errors.ServerError,
	ClientError = errors.ClientError;
module.exports = function (server) {
	server.db.packages = server.db.get('packages');
	server.db.packages.index('_created');
	server.db.packages.index('domain');
	server.db.packages.index('hostnames');
	{
		const keys = server.redis.keys('portal,packagedata,*').wait();
		if (keys.length) {
			/* useful */ console.log('Uncached ' + (server.redis.del(keys).wait()|0) + ' Packages.');
		}
	}
	const packages = Object.create(null);
	Package.prototype.__proto__ = server;
	function Package(options) {
		if (!(this instanceof Package)) { return new Package(options); }
		Object.keys(options).forEach(function (key) {
			this[key] = options[key];
		}.bind(this));
		if (typeof this.name !== 'string') { throw new Error('Package.name not a string: ' + options); }
		/*useful*/ console.log('Loading Package: ' + this.name);
		this.paths = this.paths || {};
		this.paths.views = this.paths.views || this.dirname;
		this.paths.less = this.paths.less || this.dirname;
		this.paths.javascript = this.paths.javascript || this.dirname;
		this.paths.controllers = this.paths.controllers || this.dirname;
		this.paths.files = this.paths.files || this.dirname;
		this.paths.emails = this.paths.emails || this.dirname;

		if (this.database) {
			if (this.database.redis) { this.redis = fiber.redis(this.database.redis.port, this.database.redis.host); }
			if (this.database.mongo) { this.mongo = fiber.mongo(this.database.mongo.host + '/' + this.database.mongo.database); }
			if (this.database.sql) { this.sql = fiber.sql(this.database.sql.connection); }
		}
		if (this.aws) {
			this.s3 = fiber.s3(this.aws);
			this.ses = ses.call(this);
		}
		this.controllers = Object.create(null);
		this.views = Object.create(null);
		if (fiber.fs.exists(this.paths.controllers).wait()) {
			controllers(this);
		}
		if(fs.exists(this.paths.views).wait()) {
			fs.readdirc(this.paths.views).wait()
				.forEach(function (filename) {
					if(/\.ejs$/.test(filename) && !/\.email\.ejs$/.test(filename)) {
						try {
							this.views[filename.substring(this.paths.views.length).replace(/\.ejs$/, '')] = ejs.compile('' + fs.readFile(filename).wait(), { compileDebug: this.DEBUG, open:'<%%', close: '%%>' });
						} catch (e) {
							/*useful*/ console.warn('! View Failed to compile: ', filename);
							throw e;
						}
						//*useful*/ console.log('View: ', filename.substring(this.paths.views.length));
					}
				}.bind(this));
		}
		if (fiber.fs.exists(this.paths.javascript).wait()) {
			this.javascript = fiber.fs.readdirc(this.paths.javascript).wait()
				.filter(function (filename) { return /\.js$/.test(filename); }).sort();
		}
		if (fiber.fs.exists(this.paths.less).wait()) {
			this.less = fiber.fs.readdirc(this.paths.less).wait()
				.filter(function (filename) { return /\.less$/.test(filename); }).sort();
		}
		if (fiber.fs.exists(this.paths.files).wait()) {
			this.files = files.call(this, { path: this.paths.files, bucket: this.filesBucketName });
		}
		console.log(' Loaded ' + this.name + ', ' +
			Object.keys(this.files || {}).length + ' Files, ' +
			Object.keys(this.views || {}).length + ' Views, ' +
			Object.keys(this.emails || {}).length + ' Emails, ' +
			Object.keys(this.controllers || {}).length + ' Controllers\n');
	}
	Package.prototype.controll = function (request, response) {
		const url = PathName(decodeURIComponent(request.url)),
			controller = this.controllers[url.replace(/\/[^\/]+$/, '/')],
			methodName = url.replace(/^.*\//, ''),
			lastIndex = url.lastIndexOf('/');
		if (!controller) { throw new ClientError('error:notfound:404'); }
		const method = controller.api[methodName];
		if (!method) { throw new ClientError('error:notfound:404'); }
		const controllerInstance = Object.create(controller);
		controllerInstance.package = this;
		controllerInstance.session = request.session;
		controllerInstance.session.agent = request.headers['user-agent'];
		controllerInstance.session.ip = request.connection.remoteAddress;
		controllerInstance.host = request.headers.host || '';
		controllerInstance.session.permissions = (this.defaultPermissions || []).reduce(function (obj, permission) {
			obj[permission] = 32503701600000;
			return obj;
		}, {});
		if(controllerInstance.session.user) {
			Object.keys(controllerInstance.session.user._permissions || {}).forEach(function(permission) {
				controllerInstance.session.permissions[permission] = controllerInstance.session.user._permissions[permission];
			});
		}
		controllerInstance.originalArguments = request.body;
		const result = controllerInstance.models.output.call(controllerInstance,
			method.apply(controllerInstance, controllerInstance.models.input.call(controllerInstance, request.body)));
		if (!Array.isArray(result)) { throw new Error('Controller Does Not Return An Array of args: ' + this.name + controller.namespace + methodName); }
		response.setHeader('Content-Type', 'application/json');
		if (controllerInstance.xSessionKey) {
			response.setHeader('X-Session', controllerInstance.xSessionKey);
		}
		response.end(JSON.stringify([('success' + url.substring(lastIndex) + url.substring(0, lastIndex)).replace(/\//g, ':')].concat(result)));
	};
	fs.readdirc(server.dirname + '/' + server.packages).wait()
		.filter(function (filename) {
			return /package\.config\.\w+$/.test(filename);
		})
		.forEach(function (filename) {
			const options = require(filename);
			options.server = server;
			options.name = options.name || filename.replace(/.+\/(.+)\/[^\/]+$/, function (_, name) { return name; });
			packages[options.name] = Package(options);
		}.bind(server));
	function lookup(request, response, hostname, destroyOnFail) {
		hostname = hostname ||  request.hostname;
		const key = 'portal,packagedata,' + hostname,
			saveKey = 'portal,packagedata,' + request.hostname,
			xSession = request.headers['x-session'];
		let packageData;

		request.session = {};
		//fake session:
		// request.session = {
			// user: {
				// name: 'Janitor Jimmy Jay Jimbob Jr.'
			// }
		// };
		if (xSession) {
			const results = this.redis.mget(key, xSession).wait(),
				sessionBody = results[1];
			packageData = JSON.parse(results[0]);
			if (sessionBody) {
				this.redis.expire(xSession, 604800);
				response.setHeader('X-Session', xSession);
				request.session = JSON.parse(sessionBody);
			}
		} else {
			packageData = JSON.parse(this.redis.get(key).wait() || 'null');
		}
		if (this.DEBUG) { packageData = null; }
		if (packageData && hostname === request.hostname) {
			this.redis.expire(key, 2592000);
		} else {
			packageData = (this.db.packages.find({
				domain: {
					$in: ([hostname].concat(hostname.split(/\./g).reverse().reduce(function (array, sub, index, subs) {
						if (array.length !== subs.length - 1) {
							array.unshift((index === 0 ? '.' : array[0]).replace(/^\./, '.' + sub + '.').replace(/\.$/, ''));
						}
						return array;
					}, [])))
				}
			}).wait().sort(function (a, b) {
				return b.domain.length - a.domain.length;
			})[0]);
			if (packageData) {
				packageData.hostname = request.hostname;
				this.redis.setex(saveKey, 2592000, JSON.stringify(packageData));
				let hostnames = (packageData.hostnames||[]).reduce(function (hostnames, hostname) {
					hostnames[hostname] = true;
					return hostnames;
				}, {});
				if (!hostnames[request.hostname]) {
					hostnames[request.hostname] = true;
					this.db.packages.update({ _id: packageData._id }, { $set: {
						hostnames: Object.keys(hostnames),
					} });
				}
			}
		}
		if (!packageData) {
			if (destroyOnFail && destroyOnFail > 5) {
				request.socket.destroy();
				throw new ServerError('No Domain Package Data Found.');
			} else {
				let cnamehost;
				try {
					cnamehost = (fiber.wait(dns.resolve.bind(dns), hostname, 'CNAME')||[])[0];
				} catch (error) {
					request.socket.destroy();
					throw new ServerError('Failed to resolve CNAME for package.');
				}
				return lookup.call(this, request, response, cnamehost, (destroyOnFail|0) + 1);
			}
		}
		packageData.__proto__ = packages[packageData.package];
		return packageData;
	};
	return lookup;
}
