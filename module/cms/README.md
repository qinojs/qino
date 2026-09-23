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

A leading `<style>` or several top-level elements break this: the `qcms-*` attributes land
on the wrong element, `cms.initNode(...)` gets that element as `el`, and your listeners are
never bound.

```ts
// ✗ wrong — <style> steals the qcms-id, the real content becomes a sibling
return `<style>…</style><div class=u2-flex>…</div>`;

// ✓ right — one root; put <style>/scripts inside it
return `<div class=u2-flex><style>…</style>…</div>`;
```

## Parts and client wiring

Reloadable fragments go into `parts`, wrapped in `<div cms-part="name">…</div>`. In the
client, use the helpers from `pub/js/cms.mjs` instead of calling `api` directly:

```js
cms.initNode("backend.superuser.requests.log", (el) => {
  const nid = Number(cms.el.nid(el));
  // reload one part with vars → server runs cms.node.parts[name](node, { ctx, vars })
  cms.reloadPart(nid, "list", { filter });
  // re-render the whole node
  cms.reloadNode(nid, { do: "optimize" });
});
```

`cms.initNode` runs once per node element (matched by `qcms-mod`, the module name without
`cms.`). On the server, `render` and parts run in a request context, so `getCtx()` and `app.t`
are available.

## GET parameter naming

A parameter needs a prefix when other modules may read the same request — action hooks, the
core pipeline, layouts, and content modules sharing a page. Prefix = module name with `_`
instead of `.`, then the name in camelCase: `cms_editmode`, `cms_nodeFilesZip`,
`cms_noFrontend`, `cms_versions_space`. No registry needed, and `ctx.req.query.cms_editmode`
stays plain property access.

Short names (`id`, `search`, `tab`) are fine where nothing else can collide: a backend node that
owns its page, an own route, a handler for its own upload field, or a value that must match the
node id (`export_table=<node id>`).

Exceptions (do not extend):
- `cmspid`, `lang` — core-owned, well-known short names.

## Change tracking (`node_changed`)

Every content change writes a row into `node_changed`. `lib/nodeChanged.ts` listens to the db
events (`table:insert/update/delete`), so every write through the table API is recorded.

```
node_changed
  id       PK
  log_id   request log entry (index)
  node_id  the cont/page that changed (index)
  page_id  its containing page (== node_id for pages) (index)
  data     small JSON: { table, op, name?, lang?, cols? }
```

- **A log, not a mapping**: one row per change, no dedup — editing a text and adding a file in
  one request gives two rows. Readers aggregate (`EXISTS`, `GROUP BY node_id`, `MAX(log.time)`
  via `log`). `data` is for display/debugging only, never for queries (JSON access differs per
  dialect); add a real column if you need a filter.
- **Text and file rows are found via their links**: the node comes from
  `page_text`/`page.title_id`/`page_file`. A new translation is an `INSERT` on an already linked
  `text` row, so it is tracked too.
- **Deleted nodes stay traceable**: on page delete, `page_id` is read from the parent before the
  row is gone.
- **No request context** (cron/CLI/boot): no row, like the versions history.
- `log_id` becomes `NULL` when the log row is deleted (like `page`/`text`): the rows remain but
  lose who/when (`log` → `sess` → `usr`). Field values are in the `_vers_*` tables;
  `node_changed` only links node and log.

Used by the 213 access guards in `cms.versions/serverInterface.ts` (`getForNode`,
`logDetails`) and the superuser history page (`cms.backend.superuser.versions.cms`). Older logs
have no rows (the access guard then denies).
