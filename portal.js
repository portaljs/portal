#!/usr/bin/env node
'use strict';

const DEBUG = !!process.env.PORTAL_DEBUG,
	fiber = require('carbonfibers'),
	errors = require('./errors'),
	analytics = require('./analytics'),
	packages = require('./packages'),
	views = require('./views'),
	less = (DEBUG ? require('less') : null),
	ServerError = errors.ServerError,
	fs = fiber.fs,
	colorBold = '\x1B[1m',
	colorGrey = '\x1B[90m',
	colorRed = '\x1B[31m',
	colorYellow = '\x1B[33m',
	colorWhite = '\x1B[37m',
	colorGreen = '\x1B[32m',
	colorCyan = '\x1B[1m\x1B[36m',
	colorReset = '\x1B[0m';

module.exports = Server;
Server.__proto__ = fiber.server;
Server.prototype = fiber.server.prototype;

function Server(options) {
	if (!(this instanceof Server)) {
		return new Server(options);
	}
	function handle(request, response) {
		if (DEBUG) {
			request.hostname = request.hostname.replace(/\.dev$/, '').replace(/\.dev\:/, ':');
			process.title = request.headers.host + request.url;
			/*useful*/ console.log(colorBold + 'pending --> ' + colorReset + colorBold + request.method + colorReset + ': ' + colorGrey + request.headers.host + request.url + colorReset);
			response.on('finish', function () {
				const codeType = ((response.statusCode + '')[0]|0);
				 /*useful*/ console.log('<-- ' + ((codeType === 2) ? colorGreen : ((codeType === 4) ? colorYellow : colorRed)) + response.statusCode + ' ' + colorReset + colorBold + request.method + colorReset + ': ' + request.headers.host + request.url, Date.now() - request.timestamp + 'ms');
			});
		}
		this.handleAnalytics(request, response);
		if (this.hooks && this.hooks.requests && this.hooks.requests.call(this, request, response) === false) { return; }
		if(request.location.pathname === '/favicon.ico') { return response.end(); }
		if (DEBUG) {
			if (/\.\w+$/.test(request.location.pathname)) {
				const pkg = this.package(request, response);
				if(/\.css$/.test(request.url)) {
					const parser = less.Parser();
					response.setHeader('content-type', 'text/css');
					return response.end(fiber.wait(parser.parse.bind(parser), '' + fs.readFile(pkg.paths.less + '/' + request.location.pathname.replace(/\.css$/, '.less')).wait()).toCSS({compress: false}));
				} else if(/\.js$/.test(request.url)) {
					response.setHeader('content-type', 'text/javascript');
					return response.end(fs.readFile(pkg.paths.javascript + '/' + request.location.pathname).wait());
				}
			}
		}

		try {
			if (request.method === 'GET') {
				this.view(request, response);
			} else if (request.method === 'POST') {
				Server.parseBody(request).wait();
				this.package(request, response).controll(request, response);
			} else {
				throw new ServerError('Invalid Request: Request Is Not A POST or GET.');
			}
		} catch(error) {
			errors.bind(request)(error);
		}
	}
	fiber.fork(function () {
		const port = options.port;
		fiber.server.call(this, handle.bind(this), { coors: options.coors });
		Object.keys(options).forEach(function (option) {
			this[option] = options[option];
		}.bind(this));
		this.fibers = fiber;
		this.tests = [];
		this.DEBUG = DEBUG;
		this.redis = fiber.redis(options.redisport, options.redishost);
		this.twilio = require('twilio')(process.env.TWILIOSID, process.env.TWILIOTOKEN);
		this.db = fiber.mongo(options.mongohost + '/' + options.database);
		this.ServerError = errors.ServerError;
		this.ClientError = errors.ClientError;
		this.Log = errors.Log;
		this.handleAnalytics = analytics(this);
		this.view = views(this);
		this.package = packages(this);
		fiber.wait(this.tests);
		if (this.hooks && this.hooks.initialization) {
			this.hooks.initialization.call(this, this);
		}
		this.listen(options.port);
	}.bind(this)).on('done', function (error) {
		if (error) { return errors(error); }
		/*useful*/console.log(   '\n\n'+
		'                         #\n'+
		'                        ###\n'+
		'                       ## ##\n'+
		'                      ##  ##\n'+
		'                       ####\n'+
		'                         |\n'+
		'                        ##\n'+
		'                       #### \n'+
		'                      ##  ##\n'+
		'                      ##  ##\n'+
		'                      ##  ##\n'+
		'                      ##  ##########\n'+
		'                     .##  #############\n'+
		'                .#######  ###############\n'+
		'            .#############################\n'+
		'       .###################################\n'+
		'      #####################################\n'+
		'      ##                                 ##\n'+
		'      ##,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,##\n'+
		'      #####################################\n'+
		'      ##                                 ##\n'+
		'      ##                                 ##\n'+
		'     .##                                 ###\n'+
		'   #####,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,#####\n'+
		'  ### ##################################### ###\n'+
		' ###  ##                                 ##  ###\n'+
		' ##   ##,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,##   ##\n'+
		'  ##  #####################################  ##\n'+
		'   ##                                       ##\n'+
		'    ####                                 ####\n'+
		'      ######                         ######\n'+
		'         ###############################\n'+
		' _____           _        _          ___   ___\n' +
		'|  __ \\         | |      | |        / _ \\ / _ \\\n' +
		'| |__) |__  _ __| |_ __ _| | __   _| | | | (_) |\n' +
		'|  ___/ _ \\| \'__| __/ _` | | \\ \\ / / | | |> _ <\n' +
		'| |  | (_) | |  | || (_| | |  \\ V /| |_| | (_) |\n' +
		'|_|   \\___/|_|   \\__\\__,_|_|   \\_/  \\___(_)___/\n');
	});
}
Server.errors = errors;
