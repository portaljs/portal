'use strict';
const DEBUG = !!process.env.PORTAL_DEBUG,
	slice = Array.prototype.slice,
	serverName = process.env.name,
	util = require('util'),
	IncomingMessage = require('http').IncomingMessage,
	
	fiber = require('carbonfibers'),
	redis = fiber.redis(process.env.REDISPORT|0||6379, process.env.REDISHOST),
	errorsCollection = fiber.mongo((process.env.MONGOHOST || 'localhost') + '/portal').get('errors'),
	
	prepareStackTrace = Error.prepareStackTrace,
	
	colorBold = '\x1B[1m',
	colorInverse = '\x1B[7m',
	colorRed = '\x1B[31m',
	colorYellow = '\x1B[33m',
	colorReset = '\x1B[0m',
	colorMagenta = '\x1B[35m';

errorsCollection.index('_created');

Error.prepareStackTrace = function (error, callstack) {
	error._callstack = callstack;
	if (prepareStackTrace) { return prepareStackTrace.apply(this, arguments); }
	return (callstack || []).join('\n');
};
module.exports = error;
function error(error) {
	try {
		let type = '' + error;
		if (!(error instanceof Error)) { error = new Error(error); }
		if (!DEBUG && !(error instanceof ClientError)) { type = 'error'; }
		const errorJson = {
			_created: Date.now(),
			_name: process.env.name,
			_type: type,
			_errorType: ((error instanceof ClientError || error instanceof Log) ? 'client' : (error instanceof ServerError ? (error instanceof Log ? 'log' : 'server') : 'other')),
			_message: error.message || '' + error,
			_stack: error.stack,
			_callstack: jsonCallstack(error)
		};
		if(DEBUG) {
			console.warn(colorInverse + (error instanceof ClientError ? colorYellow + (error.message + '').replace('404', colorRed + '404') + colorReset : (colorMagenta + ('' + error).replace('404', colorRed + '404') + colorReset + '\n' + colorMagenta + colorBold + error.stack)) + colorReset);
		} else if(!(error instanceof ServerError)) {
			console.warn(error + '\n' + error.stack);
		}
		if (this instanceof IncomingMessage) {
			errorJson._client = this.headers || {};
			errorJson._client.url = this.url;
			errorJson._client.method = this.method;
			errorJson._client.ip = this.connection.remoteAddress;
		}
		errorsCollection.insert(errorJson);
		redis.publish('portal:errors', JSON.stringify(errorJson));
		if (this instanceof IncomingMessage && this.response) {
			if (this.method === 'GET') {
				this.response.statusCode = 400;
				this.response.setHeader('Content-Type', 'text/html');
				this.response.end(DEBUG ? ((error + '\n' + error.stack).replace(/\n/g, '<br/>\n') + '\n<script>console.warn(' + JSON.stringify(errorJson) + ');</script>') : type);
			} else {
				this.response.setHeader('Content-Type', 'application/json');
				this.response.end(JSON.stringify([DEBUG ? errorJson : (error instanceof ClientError ? error.message : type)]));
			}
		}
	} catch (e) {
		console.log('ERRORS HAVE ERRORS!: ' + e + '\n' + e.stack + '\n\nOriginal Error:\n' + error + '\n' + (error || {}).stack);
	}
}
process.on('uncaughtException', function (e) {
	console.log('ERROR: ' + e + '\n' + (e||{}).stack + '\n');
	error.apply(null, arguments);
});

function getTypeName(site) {
	try {
		return site.getTypeName();
	} catch (e) {}
	return '';
}

function jsonCallstack(error) {
	error.stack;
	return (error._callstack||[]).map(function (call) {
		var site = {};
		try {
			site.type = call.getTypeName();
			if (!site.type) { delete site.type; }
		} catch(e) {}
		return {
			line: call.getLineNumber() + ':' + call.getColumnNumber(),
			file: call.getFileName(),
			'function': call.getFunctionName(),
			method: call.getMethodName(),
			type: getTypeName(call),
		};
	});
};
//Create New Error Types
ServerError.prototype.__proto__ = Error.prototype;
function ServerError(message) {
	if (!(this instanceof ServerError)) { return new ServerError(message); }
	Error.apply(this, arguments);
	this.message = message
	Error.captureStackTrace(this, ServerError);
}
module.exports.ServerError = ServerError;

ClientError.prototype.__proto__ = ServerError.prototype;
function ClientError(message) {
	if (!(this instanceof ClientError)) { return new ClientError(message); }
	ServerError.apply(this, arguments);
	this.message = message;
	Error.captureStackTrace(this, ClientError);
}
module.exports.ClientError = ClientError;

Log.prototype.__proto__ = ServerError.prototype;
function Log(message) {
	if (!(this instanceof Log)) { return new Log(message); }
	ServerError.apply(this, arguments);
	this.message = Array.prototype.slice.call(arguments);
	Error.captureStackTrace(this, Log);
	error(this);
}
module.exports.Log = Log;

{
	const websocketServer = new(require('ws').Server)({ port: ('3'+(process.env.PORT|0||80))|0 }),
		subredis = fiber.redis(process.env.REDISPORT|0||6379, process.env.REDISHOST);
	let errorSubscriptions = 0;
	websocketServer.on('connection', function (socket) {
		if (!errorSubscriptions) {
			subredis.subscribe('portal:errors');
			subredis.subscribe('portal:analytics');
		}
		errorSubscriptions += 1;
		function message(channel, message) {
			socket.send('[' + JSON.stringify(channel) + ',' + message + ']');
		}
		subredis.on('message', message);
		socket.on('close', function () {
			subredis.removeListener('message', message);
			errorSubscriptions -= 1;
			if (!errorSubscriptions) {
				subredis.unsubscribe('portal:errors');
				subredis.unsubscribe('portal:analytics');
			}
			/*useful*/ console.log('DEBUGGING: close', errorSubscriptions);
		});
		/*useful*/ console.log('DEBUGGING: connection', errorSubscriptions);
	});
}
{
var fs = require('fs'),
	nodemailer = require('nodemailer'),
	mailer = nodemailer.createTransport("SES", {
		AWSAccessKeyID: process.env.AWSACCESSKEYID,
        AWSSecretKey: process.env.AWSSECRETKEY,
        AWSAccountId: process.env.AWSACCOUNTID,
	}),
	
	port = process.env.PORT|0,
	write = process.stdout.write,
	buffer = [],
	count = 0,
	timer = 0;
	if (!DEBUG) {
		process.stdout.write = function (string, encoding, fd) {
			if (!timer) {
				timer = setTimeout(function () {
					var fs = require('fs'),
						subject = buffer[0],
						body = buffer.join('');
					mailer.sendMail({
						from: port + '-Legacy-Logs@buildur.com',
						to: 'brian@goldminemobile.com, adam.kilber@goldminemobile.com',
						subject: subject,
						text: body,
					}, function (error) {
						if (error) {
							setTimeout(function () {
								clearTimeout(timer);
								timer = count = 0;
								buffer = [];
							});
							throw error;
						}
					});
					timer = count = 0;
					buffer = [];
				}, 30000);
			}
			buffer.push('#' + (count += 1) + ' ' + string);
			buffer.splice(500, buffer.length - 1000);
			write.apply(process.stdout, arguments);
		};
	}
}