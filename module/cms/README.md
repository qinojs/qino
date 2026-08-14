# Developing CMS modules

Access/permissions are documented in [ACCESS.md](ACCESS.md).

A CMS module renders a page node. It exports a `cms.node` contract from its `plugin.ts`:

```ts
export const cms = {
  node: {
    css: ["pub/main.css"],   // stylesheets, added to the page <head>
    js:  ["pub/main.js"],    // client scripts, added to the page <head>
    render,                  // (node, { ctx, vars }) => string  — the node HTML
    parts: { list },         // named sub-renderers, reloadable on their own
  },
};
```

## Render output must be a single root element

`render` (and any `part` that replaces a node) **must return exactly one root element.**
The CMS injects `qcms-id` / `qcms-mod` into the **first tag** of the (trimmed) output
(`Node.htmlPrepared`, regex `/^<([^\s>]+)…/`).

A leading `<style>` or several top-level siblings break this: the `qcms-*` attributes land
on the wrong element. In the browser `cms.initNode(...)` then receives that wrong element as
`el`, so `el.querySelector(...)` misses your forms/buttons, no listener binds, and nothing
happens.

```ts
// ✗ wrong — <style> steals the qcms-id, the real content becomes a sibling
return `<style>…</style><div class=u2-flex>…</div>`;

// ✓ right — one root; put <style>/scripts inside it
return `<div class=u2-flex><style>…</style>…</div>`;
```

## Parts and client wiring

Expose reloadable fragments via `parts` and wrap them in `<div cms-part="name">…</div>`.
From the client, use the built-in helpers (see `pub/js/cms.mjs`) instead of calling `api`
directly:

```js
cms.initNode("backend.superuser.log", (el) => {
  const nid = Number(cms.el.nid(el));
  // reload one part with vars → server runs cms.node.parts[name](node, { ctx, vars })
  cms.reloadPart(nid, "list", { filter });
  // re-render the whole node
  cms.reloadNode(nid, { do: "optimize" });
});
```

`cms.initNode` fires once per node element (matched by `qcms-mod`, i.e. the module name
without the leading `cms.`). Server-side, `render`/parts always run inside a request context,
so `getCtx()` and `app.t` are available.

## GET parameter naming

Parameters read outside your own node rendering (action hooks, core pipeline) are
namespaced: module name with `_` instead of `.`, then the parameter name in camelCase —
`cms_editmode`, `cms_nodeFilesZip`, `cms_noFrontend`, `cms_versions_space`.
This avoids collisions without a registry and keeps `ctx.req.query.cms_editmode` as plain
property access.

Parameters read only by your own backend node stay short and unprefixed
(`id`, `search`, `tab`) — the page scopes them.

Exceptions (do not extend):
- `cmspid`, `lang` — core-owned, well-known short names.

## Change tracking (`node_changed`)

Every content mutation writes one row into `node_changed`, captured at the db-event
level (`table:insert/update/delete`) in `lib/nodeChanged.ts` — so every write path
through the table API is recorded without per-method instrumentation.

```
node_changed
  id       PK
  log_id   request log entry (index)
  node_id  the cont/page that changed (index)
  page_id  its containing page (== node_id for pages) (index)
  data     small JSON: { table, op, name?, lang?, cols? }
```

- **Event log, not a mapping**: one row per mutation, no dedup — text edited and file
  added in the same request = two rows. Consumers aggregate (`EXISTS`, `GROUP BY node_id`,
  `MAX(log.time)` via the `log` join). `data` is a display/debug payload, never a query
  surface (JSON access is dialect-specific); promote a real column when a filter is needed.
- **Shared text/file rows resolve through their links**: `text`/`file` are reference rows;
  the node is found via `page_text`/`page.title_id`/`page_file`. Adding a translation is an
  `INSERT` on an already-linked `text` row, so multilingual edits are tracked too.
- **Deleted/moved nodes stay resolvable**: on page delete, `page_id` is taken from the
  parent side (basis) before the row disappears.
- **No request context** (cron/CLI/boot): no row — like the versions history capture.
- `log_id` is `setnull` on log delete (like `page`/`text`): pruning logs keeps the history
  rows, they just lose their who/when (which live in `log` → `sess` → `usr`). Field values
  live in the `_vers_*` shadow tables; `node_changed` is only the node↔log index.

Consumers: the 213 access guards in `cms.versions/serverInterface.ts` (`getForNode`,
`logDetails`), and the superuser history page (`cms.backend.superuser.versions.cms`).
No backfill — pre-existing logs simply have no rows (fail-closed for the access guard).
