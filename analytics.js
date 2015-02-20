var agents, querystring,
  __hasProp = {}.hasOwnProperty;

querystring = require('querystring');

agents = [[['total', /^/]], [['mobile', /android|mobile|phone|pad|pod|tab/i], ['desktop', /^/]], [['opera', /opera/i], ['firefox', /firefox/i], ['chrome', /chrom/i], ['ie', /trident/i], ['oldie', /msie/i], ['safari', /safari/i], ['unknown', /^/]], [['android', /android/i], ['linux', /linux|ubuntu/i], ['windows', /windows/i], ['ios', /iphone|ipad|ipod|ios/i], ['osx', /os\s?x|mac/i], ['other', /^/]]];

module.exports = function(server) {
  var interval, setIndexes, _i, _len, _ref;
  setIndexes = function(collectionName, prefix) {
    var catagory, collection, test, _i, _j, _len, _len1;
    collection = server.db[collectionName] = server.db.get(collectionName);
    collection.index('_created');
    for (_i = 0, _len = agents.length; _i < _len; _i++) {
      catagory = agents[_i];
      for (_j = 0, _len1 = catagory.length; _j < _len1; _j++) {
        test = catagory[_j];
        collection.index("" + prefix + test[0], {
          sparse: true
        });
      }
    }
    return collection.index('_query.id', {
      sparse: true
    });
  };
  setIndexes('analytics', '_data.');
  _ref = ['minutes', 'hours', 'days'];
  for (_i = 0, _len = _ref.length; _i < _len; _i++) {
    interval = _ref[_i];
    setIndexes('analytics_' + interval, '');
  }
  return function(request, response) {
    var date, headers, host, method, query, url;
    headers = request.headers || {};
    method = request.method;
    host = headers.host || '';
    url = decodeURIComponent("" + (request.url || ''));
    query = querystring.parse(("" + request.url).replace(/^.*\?|^.+$/, ''));
    date = new Date;
    return response.on('finish', function() {
      var analytics, catagory, header, hit, socket, test, _j, _k, _len1, _len2, _ref1, _ref2;
      socket = request.connection;
      analytics = {
        _id: server.db.oid(),
        _created: +date,
        _updated: Date.now(),
        _method: method,
        host: host,
        _url: url,
        _query: query,
        _data: {},
        _remoteAddress: socket.remoteAddress,
        _length: Date.now() - request.timestamp,
        _bytesRead: socket.bytesRead,
        _bytesWritten: socket.bytesWritten,
        _userId: (_ref1 = request.session) != null ? (_ref2 = _ref1.user) != null ? _ref2._id : void 0 : void 0,
        user_agent: ''
      };
      for (header in headers) {
        if (!__hasProp.call(headers, header)) continue;
        analytics[header.replace(/[\W_]+/g, '_')] = headers[header];
      }
      for (_j = 0, _len1 = agents.length; _j < _len1; _j++) {
        catagory = agents[_j];
        for (_k = 0, _len2 = catagory.length; _k < _len2; _k++) {
          test = catagory[_k];
          if (test[1].test(analytics.user_agent)) {
            analytics._data[test[0]] = 1;
            break;
          }
        }
      }
      request.emit('analytics', analytics);
      server.redis.publish('portal:analytics', JSON.stringify(analytics));
      server.db.analytics.insert(analytics);
      hit = function(interval, datetime) {
        var collection;
        collection = server.db['analytics_' + interval];
        return collection.update({
          _created: datetime,
          method: method,
          host: host,
          url: url
        }, {
          $setOnInsert: {
            _created: datetime,
            method: method,
            host: host,
            url: url,
            query: query
          },
          $inc: analytics._data
        }, {
          upsert: true
        });
      };
      date.setUTCMilliseconds(0);
      date.setUTCSeconds(0);
      hit('minutes', +date);
      date.setUTCMinutes(0);
      hit('hours', +date);
      date.setUTCHours(0);
      return hit('days', +date);
    });
  };
};
