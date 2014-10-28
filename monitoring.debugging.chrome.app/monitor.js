'use strict';
function socket(port) {
	var connecting = false;
	function connect() {
		if (!connecting) {
			connecting = true;
			setTimeout(function () {
				connecting = false;
				if (window.ws) { window.ws.close(); }
				try { var ws = new WebSocket('ws://localhost:' + port); } catch (e) { connect(); return; }
				ws.onopen = function () {
					console.log('WS:open', port, 'Ready!');
					ws.onclose = function () {
						console.log('WS:close', port);
					};
				};
				ws.onclose = connect;
				ws.onerror = connect;
				ws.onmessage = message;
			}, 1000 + (Math.random() * 1000));
		}
	}
	connect();
}

function message(message) {
	var args = [];
	try { args = JSON.parse(message.data); } catch(e) {}
	display.apply(null, args);
}
function geo(ip, callback) {
	var geo = localStorage['geo:' + ip];
	if (!geo) {
		if (ip === '127.0.0.1') {
			navigator.geolocation.getCurrentPosition(function (geo) {
				geo = {
					latitude: geo.coords.latitude,
					longitude: geo.coords.longitude,
				};
				localStorage['geo:' + ip] = JSON.stringify(geo);
				callback(geo);
			});
		} else {
			$.getJSON('http://www.geoplugin.net/json.gp?jsoncallback=?', function (geo) {
				geo = {
					latitude: geo.geoplugin_latitude,
					longitude: geo.geoplugin_longitude,
				};
				localStorage['geo:' + ip] = JSON.stringify(geo);
				callback(geo);
			});
		}
		return;
	} else {
		setTimeout(callback.bind(null, JSON.parse(geo)));
	}
}
RegExp.escape = function(text) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
};
window.debugFilterUser = function (username) {
	return function (event) {
		return (event && event.env && new RegExp(RegExp.escape(username), 'i').test(event.env.USERNAME));
	}
}
function filterEvents(event) {
	var debugFilterUser = JSON.parse(localStorage['event.debugFilterUser']||'""'),
		errorTypes = JSON.parse(localStorage['event.errorType']||'{}');
	return ((errorTypes[event.errorType] !== false)
		&& (debugFilterUser ? window.debugFilterUser(debugFilterUser)(event) : true)
		&& (event._url ? ((errorTypes['portal:analytics(static files)'] !== false) ? true : !/\.\w+$/.test(event._url)) : true));
}
function display(type, event) {
	event.errorType = event.errorType || type;
	if (filterEvents(event)) {
		if (!window.debugErrorFilter || window.debugErrorFilter(event)) {
			console.log(event);
		}
		geo((event._client||{}).ip || event._remoteAddress || '127.0.0.1', function (geo) {
			convertImgToBase64('http://maps.googleapis.com/maps/api/staticmap?center=' + geo.latitude + ',' + geo.longitude + '&zoom=8&size=128x128&maptype=terrain', function (icon) {
				chrome.notifications.create((typeof event.message === 'string' ? event.message : false) || type || 'unknown', {
					type: 'basic',
					//iconUrl: 'icon.png',
					iconUrl: icon,
					title: ('' + (event.errorType || type || '')).toUpperCase() + ' ' + event.message,
					message: event.stack || event.message || JSON.stringify(event),
				}, function () {
					//console.log('http://maps.googleapis.com/maps/api/staticmap?center=' + geo.latitude + ',' + geo.longitude + '&zoom=8&size=128x128&maptype=terrain');
				});
			});
		});
	}
}

function convertImgToBase64(url, callback, outputFormat) {
    var canvas = document.createElement('CANVAS'),
        context = canvas.getContext('2d'),
        image = new Image;
    image.crossOrigin = 'Anonymous';
    image.onload = function(){
        canvas.height = image.height;
        canvas.width = image.width;
        context.drawImage(image, 0, 0);
        callback.call(this, canvas.toDataURL(outputFormat));
        canvas = null; 
    };
    image.src = url;
}

function Promise(method, args) {
	if (!(this instanceof Promise)) { return new Promise(methods, args); }
	if (Array.isArray(method)) {
		this.method = function () {
			var active = 0,
				promises = method.map(function (promise) {
					active += 1;
					if (!(promise instanceof Promise)) {
						if (Array.isArray(promise)) {
							promise = Promise.apply(null, promise);
						} else if (promise instanceof Function) {
							promise = new Promise(promise, this.args);
						}
					}
					promise.get(function () {
						active -= 1;
						if (active < 1) { this.set(null, promises.map(function (promise) { return promise.results; })); }
					}.bind(this));
					return promise;
				}.bind(this));
		};
	} else {
		this.method = method;
	}
	this.args = Array.isArray(args) ? args : [args];
	this.callbacks = [];
	this.results = null;
	
	this.method.apply(this, this.args);
}
Promise.prototype.set = function () {
	this.results = Array.prototype.slice.call(arguments);
	this.callbacks.forEach(function (callback) {
		setTimeout(function () {
			callback.apply(this, this.results);
		}.bind(this));
	}.bind(this));
	this.callbacks = [];
	return this;
}
Promise.prototype.get = function (callback) {
	this.callbacks.push(callback);
	if (this.results) { this.fulfill(); }
	return this;
}

socket(380);
socket(38080);
socket(38081);
socket(38082);
socket(38083);