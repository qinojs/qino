
// Extract the url of a dragged image/file from a DataTransfer, across the differing browser formats
// (firefox: x-moz-file-promise / x-moz-url, chrome: text/uri-list / text/html). Returns null for local files.
export function dataTransferToUrl(dt) {
  const getData = type => dt.getData(type);
  const fileurl1 = getData('application/x-moz-file-promise-url');
  const html     = getData('text/html') || '';
  const matches  = html.match(/.*<img src="([^"]*)".*/);
  const fileurl2 = matches && matches[1];
  let   url = null;
  const mozUrl = getData('text/x-moz-url');
  if (mozUrl) url = mozUrl.split('\n')[0];
  const fileurl3 = (getData('url') || url || '').trim();
  const fileurl = fileurl1 || fileurl2 || fileurl3;
  if (fileurl.startsWith('file')) return null;
  return fileurl;
}
