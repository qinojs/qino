# Developing CMS modules

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
From the client, use the built-in helpers (see `pub/js/cms.mjs`) instead of calling `apt`
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
