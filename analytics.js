'use strict';
const hasOwn = Object.prototype.hasOwnProperty,
	tests = [{
		total: /^/
	}, {
		mobile: /android|mobile|phone|pad|pod|tab/i,
		desktop: /^/
	}, {
		opera: /opera/i,
		firefox: /firefox/i,
		chrome: /chrom/i,
		ie: /trident/i,
		oldie: /msie/i,
		safari: /safari/i,
		unknown: /^/
	}, {
		android: /android/i,
		linux: /linux|ubuntu/i,
		windows: /windows/i,
		ios: /ip(hone|ad|od)|ios/i,
		osx: /os\s?x|mac/i,
		other: /^/
	}],
	last = {
		minutes: 0,
		hours: 0,
		days: 0,
	};
module.exports = function (server) {
	function index(collection) {
		collection.index('_created', { unique: true });
		tests.forEach(function (nameTable) {
			Object.keys(nameTable).forEach(function (indexName) {
				collection.index(indexName, { sparse: true });
			});
		});
	}
	server.db.analytics = server.db.get('analytics');
	server.db.analytics.index('_created');
	tests.forEach(function (nameTable) {
		Object.keys(nameTable).forEach(function (indexName) {
			server.db.analytics.index('_analytics.' + indexName, { sparse: true });
		});
	});
	server.db.analytics_minutes = server.db.get('analytics_minutes');
	index(server.db.analytics_minutes);
	server.db.analytics_hours = server.db.get('analytics_hours');
	index(server.db.analytics_hours);
	server.db.analytics_days = server.db.get('analytics_days');
	index(server.db.analytics_days);
	
	return function (request, response) {
		response.on('finish', function () {
			const socket = request.connection,
				analytics = {
					_id: server.db.oid(),
					_created: Date.now(),
					_url: request.url,
					_remoteAddress: socket.remoteAddress,
					_timestamp: request.timestamp,
					_length: Date.now() - request.timestamp,
					_bytesRead: socket.bytesRead,
					_bytesWritten: socket.bytesWritten,
					_analytics: {},
					user_agent: ''
				};
			Object.keys(request.headers).forEach(function (header) {
				analytics[(''+header).replace(/\W+/g,'_').replace(/^_+/,'').toLowerCase()] = request.headers[header];
			});
			tests.forEach(function (tests) {
				const keys = Object.keys(tests);
				let index = 0
				while (index < keys.length) {
					if (tests[keys[index]].test(analytics.user_agent)) {
						analytics._analytics[keys[index]] = 1;
						break;
					}
					index += 1;
				}
			});
			if (request.method === 'GET') {
				analytics._analytics.get = 1;
			}
			if (request.method === 'POST') {
				analytics._analytics.post = 1;
			}
			analytics._analytics
			if (request.session && request.session.user && request.session.user._id) {
				analytics._userId = request.session.user._id;
			}
			request.emit('analytics', analytics);
			server.redis.publish('portal:analytics', JSON.stringify(analytics));
			server.db.analytics.insert(analytics);
			
			function hit(interval, datetime) {
				const collection = server.db['analytics_' + interval];
				collection
					.update({ _created: datetime }, { $inc: analytics._analytics })
					.on('success', function (count) {
						if (count < 1) {
							var data = JSON.parse(JSON.stringify(analytics._analytics));
							data._created = datetime;
							data._updated = datetime;
							collection.insert(data)
								.on('error', function () {
									// Edge case if another instance created first:
									collection.update({ _created: datetime }, { $inc: analytics._analytics });
								});
						}
					});
			}
			let date = new Date();
			date.setUTCMilliseconds(0);
			date.setUTCSeconds(0);
			hit('minutes', +date);
			date.setUTCMinutes(0);
			hit('hours', +date);
			date.setUTCHours(0);
			hit('days', +date);
		}.bind(this));
	};
};