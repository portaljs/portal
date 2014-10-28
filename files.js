'use strict';
const fibers = require('carbonfibers'),
	wait = fibers.wait,
	fs = fibers.fs,
	crypto = require('crypto'),
	mime = require('mime'),
	slice = Array.prototype.slice;
function hashFile(filename, type, digest) {
	const promise = fibers(),
		hash = crypto.createHash(type || 'md5');
	fs.ReadStream(filename)
		.on('data', function (data) { hash.update(data); })
		.on('end', function () { promise.fulfill(null, hash.digest(digest || 'hex')); });
	return promise;
}
module.exports = function (options) {
	if (!this.s3) { return {}; }
	const filesMap = {},
		bucket = options.bucket || '_files',
		prefix = (this.DEBUG ? 'debug/' : '') + 'static/' + this.name;
	let bucketRequest = this.s3.listObjects({
			Bucket: bucket,
			Prefix: prefix,
		}).wait(),
		bucketFiles = bucketRequest.Contents;
	while (bucketRequest.IsTruncated) {
		bucketRequest = bucketRequest.nextPage().wait();
		bucketFiles = bucketFiles.concat(bucketRequest.Contents);
	}
	bucketFiles = bucketFiles.reduce(function (files, file) {
		files[file.Key] = file;
		return files;
	}, {});
	//* useful */ console.log('Loading Files For Package: ' + this.name);
	wait(fs.readdirc(options.path).wait().filter(function (filename) {
		// Get rid of junk files:
		return !/Thumbs\.db$|ehthumbs\.db$|Desktop\.ini$|~$|npm-debug\.log$|__MACOSX$|\..*\.swp$|\.DS_Store|\.AppleDouble$|\.LSOverride$|Icon[\r\?]?|\._.*|.Spotlight-V100$|\.Trashes/.test(filename);
	}).map(function (filename) {
		return fibers.fork(function () {
			if (fs.lstat(filename).wait().isFile()) {
				const name = filename.substring(options.path.length),
					etag = JSON.stringify(hashFile(filename).wait());
				let urlName = '';
				
				//// Optimize symbolic linking:
				// if (bucketFiles.filter(function (bucketFile) {
					// if (bucketFile.ETag === etag) {
						// urlName = bucketFile.Key;
						// //* useful */ console.log('ETag Match: ', name);
						// return true;
					// }
					// return false;
				// }).length < 1) {
				
				urlName = prefix + name;
				if (!bucketFiles[prefix + name] || bucketFiles[prefix + name].ETag !== etag) {
					/* useful */ console.log('Uploading: ', name);
					this.s3.putObject({
						Bucket: bucket,
						ACL: 'public-read',
						Key: prefix + name,
						ContentType: mime.lookup(name),
						Body: fs.ReadStream(filename),
					}).wait();
				}
				filesMap[name] = 'https://s3.amazonaws.com/' + bucket + '/' + urlName;
			}
		}.bind(this));
	}.bind(this)));
	return filesMap;
};