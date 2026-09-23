# serviceworker

A browser allows one service worker per scope. This module provides it; any module can add a
part by shipping `pub/sw.js` and depending on this module:

```json
{ "dependencies": ["core", "serviceworker"], "files": ["pub/sw.js"] }
```

The file itself is the declaration (`files` is generated on publish). No registration call: the
worker is built per request from the currently linked modules, so unlinking a module removes its
part.

The worker is served at `<appUrl>sw.js` and contains only `import` statements, one per part. A part
is a plain ES module that adds its own listeners:

```js
self.addEventListener("push", (e) => { /* … */ });
```

Events allow several listeners, so parts don't interfere. Exception: `fetch` — only one listener
may call `respondWith()`. When a second module needs `fetch`, add a small router here.

Without a part there is no `sw.js` route and no registration script.

## Notes

- A part that fails to load breaks the *whole* worker installation.
- Import maps do not apply to workers — a part must not import bare specifiers.

## Caching

`sw.js` is served with `Cache-Control: no-cache` and an `ETag`, so an update check is usually a
304 without body. `no-cache` means "store, but revalidate before use" — exactly right here.

A `max-age` would not help: with the default `updateViaCache: "imports"` the browser skips the
HTTP cache for the worker script anyway. The imported parts may come from the HTTP cache; they are
static files with an `ETag`.
