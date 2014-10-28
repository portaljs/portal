'use strict';
const fibers = require('carbonfibers'),
	fs = fibers.fs,
	ejs = fibers.ejs;
module.exports = function () {
	const views = this.emails = Object.create(null),
		mailer = fibers.mailer({
			AWSAccessKeyID: this.aws.accessKeyId,
			AWSSecretKey: this.aws.secretAccessKey
		});
	if (fs.exists(this.paths.emails).wait()) {
		fs.readdirc(this.paths.emails).wait()
			.forEach(function (filename) {
				if(/\.email\.ejs$/.test(filename)) {
					views[filename.substring(this.paths.emails.length).replace(/\.email\.ejs$/, '')] = ejs.compile('' + fs.readFile(filename).wait(), { compileDebug: this.DEBUG, open:'<%%', close: '%%>' });
					//*useful*/ console.log('Email Compiled And Cached: ', filename.substring(this.paths.emails.length));
				}
			}.bind(this));
	}
	return function (view, options) {
		options.from = options.from || this.email.noreply;
		if(this.DEBUG) {
			return mailer.renderSendMail(ejs.compile('' + fs.readFile(this.paths.emails + view + '.email.ejs').wait(), { compileDebug: true, open:'<%%', close: '%%>'  }), options).wait();
		} else {
			if(!views[view]) { throw new Error('Email View Does Not Exist In Package: ' + this.package.name + '! ' + view); }
			return mailer.renderSendMail(views[view], options).wait();
		}
	};
};