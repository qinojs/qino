# serviceworker

A browser allows one service worker per scope. This module owns that one worker for the
app; every module may contribute one part to it, by shipping a `pub/sw.js` and depending
on this module:

```json
{ "dependencies": ["core", "serviceworker"], "files": ["pub/sw.js"] }
```

The file is the declaration — `files` is generated for every published module, so there
is nothing to keep in sync. That is the whole contract — no registration call, and nothing to undo: the worker is
assembled per request from the modules that are linked right then, so unlinking a module
drops its part by itself.

The worker is served at `<appUrl>sw.js` and contains nothing but `import` statements —
one per part. A part is a plain ES module that adds its own listeners:

```js
self.addEventListener("push", (e) => { /* … */ });
```

Service worker events are multi-listener, so parts never interfere. The one exception is
`fetch`: only a single listener may call `respondWith()`. When a second module needs
`fetch`, this module should grow a small router instead.

Without a part there is no `sw.js` route and no registration script.

## Notes

- A part that fails to load breaks the *whole* worker — one failing static import fails
  the installation.
- Import maps do not apply to workers — a part must not import bare specifiers.

## Caching

`sw.js` is served with `Cache-Control: no-cache` plus an `ETag` over its content, so an
update check costs a conditional request and usually gets a bodyless 304. `no-cache`
does not mean "do not store" — it means "store, but revalidate before use", which is
exactly what a service worker needs.

A `max-age` would not help much: with the default `updateViaCache: "imports"` the
browser bypasses the HTTP cache for the worker script itself anyway. That setting *does*
let the imported parts come from the HTTP cache, and those are static files, which the
file server already serves with an `ETag`.
