/* Copyright (c) 2016 Tobias Buschor https://goo.gl/gl0mbf | MIT License https://goo.gl/HgajeK */

// Extract the url of a dragged image/file from a DataTransfer, across the differing browser formats
// (firefox: x-moz-file-promise / x-moz-url, chrome: text/uri-list / text/html). Returns null for local files.
export function dataTransferToUrl(dt) {
	const getData = type => dt.getData(type);
	const fileurl1 = getData('application/x-moz-file-promise-url');
	const html     = getData('text/html') || '';
	const matches  = html.match(/.*<img src="([^"]*)".*/, '$1');
	const fileurl2 = matches && matches[1];
	let   url = null;
	if (getData('text/x-moz-url')) {
		url = getData('text/x-moz-url').split('\n')[0];
	}
	let fileurl3 = getData('url') || url || '';
	fileurl3 = fileurl3.trim();
	const fileurl = fileurl1 || fileurl2 || fileurl3;
	if (fileurl.match(/^file/)) return null;
	return fileurl1 || fileurl2 || fileurl3;
}

// Read pasted html (or plain text joined with <br>) and pass it to cb. Returns 1 if something was handled, else 0.
export function readClipboardHtml(cd, cb) {
	const items = cd.items ?? [];
	let alternative = null;
	for (let i = 0, item; (item = items[i++]);) {
		if (item.type === 'text/html') {
			item.getAsString(cb);
			return 1;
		}
		if (item.type === 'text/plain') alternative = item;
	}
	if (alternative) {
		alternative.getAsString(text => {
			cb( text.replace(/\n/g,'<br>') );
		});
		return 1;
	}
	return 0;
}
