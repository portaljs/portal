querystring = require 'querystring'

agents = [
  [
    ['total', /^/]
  ]
  [
    ['mobile', /android|mobile|phone|pad|pod|tab/i]
    ['desktop', /^/]
  ]
  [
    ['opera', /opera/i]
    ['firefox', /firefox/i]
    ['chrome', /chrom/i]
    ['ie', /trident/i]
    ['oldie', /msie/i]
    ['safari', /safari/i]
    ['unknown', /^/]
  ]
  [
    ['android', /android/i]
    ['linux', /linux|ubuntu/i]
    ['windows', /windows/i]
    ['ios', /iphone|ipad|ipod|ios/i]
    ['osx', /os\s?x|mac/i]
    ['other', /^/]
  ]
]

module.exports = (server) ->

  setIndexes = (collectionName, prefix) ->
    collection = server.db[collectionName] = server.db.get collectionName
    collection.index '_created'
    for catagory in agents
      for test in catagory
        collection.index "#{prefix}#{test[0]}", sparse: true
    collection.index '_query.id', sparse: true
  setIndexes 'analytics', '_data.'
  for interval in ['minutes', 'hours', 'days']
    setIndexes 'analytics_' + interval, ''

  (request, response) ->
    headers = request.headers or {}
    method = request.method
    host = headers.host or ''
    url = decodeURIComponent "#{request.url or ''}"
    query = querystring.parse "#{request.url}".replace /^.*\?|^.+$/, ''
    date = new Date

    response.on 'finish', ->
      socket = request.connection
      analytics =
        _id: server.db.oid()
        _created: +date
        _updated: Date.now()
        _method: method
        host: host
        _url: url
        _query: query
        _data: {}
        _remoteAddress: socket.remoteAddress
        _length: Date.now() - request.timestamp
        _bytesRead: socket.bytesRead
        _bytesWritten: socket.bytesWritten
        _userId: request.session?.user?._id
        user_agent: ''
      for own header of headers
        analytics[header.replace /[\W_]+/g, '_'] = headers[header]
      for catagory in agents
        for test in catagory
          if test[1].test analytics.user_agent
            analytics._data[test[0]] = 1
            break

      request.emit 'analytics', analytics
      server.redis.publish 'portal:analytics', JSON.stringify(analytics)
      server.db.analytics.insert analytics

      hit = (interval, datetime) ->
        collection = server.db['analytics_' + interval]
        collection.update {
            _created: datetime
            method: method
            host: host
            url: url
          }, {
            $setOnInsert:
              _created: datetime
              method: method
              host: host
              url: url
              query: query
            $inc: analytics._data
          }, upsert: on
      date.setUTCMilliseconds 0
      date.setUTCSeconds 0
      hit 'minutes', +date
      date.setUTCMinutes 0
      hit 'hours', +date
      date.setUTCHours 0
      hit 'days', +date
