'use strict';
const DEBUG = process.env.PORTAL_DEBUG,
	querystring = require('querystring'),
	url = require('url'),
	fiber = require('carbonfibers'),
	less = require('less'),
	uglify = require('uglify-js'),
	mongo = fiber.mongo,
	fs = fiber.fs,
	ejs = fiber.ejs;
module.exports = function (server) {
	{
		const keys = server.redis.keys('portal,pagecache,*').wait();
		if (keys.length) {
			/* useful */ console.log('Uncached ' + (server.redis.del(keys).wait()|0) + ' Pages.');
		}
	}
	return function (request, response) {
		let viewName = request.location.pathname.toLowerCase(),
			redirecting = false,
			master,
			page;
		if(/\/$/.test(viewName)) { viewName += 'index'; }
		if(!/^\/[\w\/]*(\?|$)/i.test(viewName)) { viewName = '/404'; }
		const ajaxing = !!request.headers['x-requested-with'],
			pageKey = 'portal,pagecache,' + request.hostname + ',' + request.method + ',' + request.hostname + viewName,
			headKey = 'portal,pagecache,' + request.hostname + ',HEAD,';
		if (ajaxing) {
			page = this.redis.get(pageKey).wait();
		} else {
			const pages = this.redis.mget(headKey, pageKey).wait()
			master = pages[0];
			page = pages[1];
		}
		if(page) { this.redis.expire(pageKey, 2592000); }
		if(DEBUG) { master = null; page = null; }
		if (page) { redirecting = /^\["redirect"/.test(page); }
		if(!redirecting && ((!master && !ajaxing) || !page)) {
			const pkg = this.package(request, response),
				options = {
					'package': pkg,
					server: pkg.server,
					file: function (fileName) {
						return pkg.files[fileName];
					},
				};
			if (options.package.redirects && options.package.redirects[viewName]) {
				redirecting = true;
				page = JSON.stringify(['redirect']
					.concat(Array.isArray(options.package.redirects[viewName])
						? options.package.redirects[viewName]
						: [options.package.redirects[viewName]]));
			} else {
				options.DEBUG = DEBUG;
				if (!master && !ajaxing) {
					options.styles = ((pkg.less) ? pkg.less.map(function (filename) {
						const parser = less.Parser();
						return fiber.wait(parser.parse.bind(parser), '' + fs.readFile(filename).wait()).toCSS({ compress: true });
					}) : []);
					options.scripts = ((pkg.javascript) ? pkg.javascript.map(function (filename) {
						try {
							const file = fs.readFile(filename).wait();
							if(/\.min\.js$/.test(filename)) { return file; }
							const ast = uglify.parse('' + file);
							ast.figure_out_scope();
							return ast.transform(uglify.Compressor({
								unsafe: true,
								warnings: false
							})).print_to_string();
						} catch (error) {
							throw new Error('Javascript Parse Error:\n'
								+ filename + '\n'
								+ error + '\n'
								+ error.stack);
						}
					}) : []);
					options.PAGE = '<%- PAGE %>';
					if(DEBUG) {
						master =  ejs.compile('' + fs.readFile(pkg.paths.views + pkg.defaultMasterPage + '.master.ejs').wait(), { compileDebug: true, open:'<%%', close: '%%>' })(options);
					} else {
						if(!pkg.views[pkg.defaultMasterPage + '.master']) { throw new Error('Master Page Does Not Exist In Package: ' + pkg.name + '! ' + pkg.defaultMasterPage); }
						master = pkg.views[pkg.defaultMasterPage + '.master'](options);
					}
					if (master) { this.redis.setex(headKey, 2592000, master); }
				}
				if (!page) {
					const render = function (viewName, mergeOptions) {
						const mergedOptions = Object.create(options);
						Object.keys(Object(mergeOptions)).forEach(function (key) {
							mergedOptions[key] = mergeOptions[key];
						});
						mergedOptions.options = mergedOptions;
						if(DEBUG) {
							if (!fs.exists(pkg.paths.views + viewName + '.ejs').wait()) {
								/* useful */ console.warn('View Not Found 404: ', pkg.paths.views + viewName + '.ejs');
								throw new Error('404 Page Does Not Exist In Package: ' + pkg.name + '! ' + request.url);
							}
							return ejs.compile('' + fs.readFile(pkg.paths.views + viewName + '.ejs').wait(), { compileDebug: true, open:'<%%', close: '%%>' })(mergedOptions);
						} else {
							if(!pkg.views[viewName]) { viewName = '/404'; }
							if(!pkg.views[viewName]) { throw new Error('404 Page Does Not Exist In Package: ' + pkg.name + '! ' + request.url); }
							return pkg.views[viewName](mergedOptions);
						}
					}
					page = render(viewName, { render: render, });
				}
			}
			if(page) { this.redis.setex(pageKey, 172800, page); }
		}
		if (redirecting) {
			const redirect = JSON.parse(page),
				links = Array.isArray(redirect[1]) ? redirect[1] : [redirect[1]],
				options = redirect[2] || {},
				distribute = options.distribute || 'random',
				query = options.query === false ? false : true;
			let link = links[0] || '/';
			if (distribute === 'random') {
				link = links[Date.now() % links.length];
			}
			if (query) {
				const linkObject = url.parse(link),
					locationQuery = querystring.parse(request.location.query),
					linkQuery = querystring.parse(linkObject.query);
				linkObject.search = querystring.stringify(Object.keys(locationQuery).reduce(function (queryObject, key) {
					if (queryObject[key] && !Array.isArray(queryObject[key])) {
						queryObject[key] = [queryObject[key]];
					}
					if (Array.isArray(queryObject[key])) {
						queryObject[key].push(locationQuery[key]);
					} else {
						queryObject[key] = locationQuery[key];
					}
					return queryObject;
				}, linkQuery));
				link = url.format(linkObject);
			}
			response.writeHead(302, { 'Location': link, });
			return response.end();
		}
		if (DEBUG) { // <-- no-caching on debugging
			response.writeHead(200, {
				'Cache-Control': 'no-cache, no-store, must-revalidate',
				'Content-Type': 'text/html',
				'Pragma': 'no-cache',
				'Expires': '0'
			});
		} else {
			response.writeHead(200, {
				'Content-Type': 'text/html',
				//TODO: figure out client side caching... .manifest file...
			});
		}
		if (ajaxing) {
			return response.end(page);
		} else {
			return response.end(master.replace('<%- PAGE %>', page));
		}
	}.bind(server);
}