# cms.cont.flexible

A container for any content: its children, in the editor's order. Being the simplest container,
it also hosts the shared list panel.

## The list panel

[pub/list.js](pub/list.js) is the panel for containers with children: a sortable list (drag
handle, title, module, settings, copy, delete), "Add entry", and the settings `default module`
and `add position`. Every change re-renders the block on the page.

It lives here because a menu or gallery needs the list but not the rendering. `cms.cont.items`
uses it unchanged; this module adds one extra (below).

### A listing module borrows it

```ts
// plugin.ts
export const cms = { node: { render, widget: "pub/options.js" } };
```

```js
// pub/options.js — the whole file
import list, { css } from '../../cms.cont.flexible/pub/list.js';

export { css };
export default (widget, context) =>
  list(widget, { ...context, module: 'cms.cont.luca.menu.item', position: 'bottom' });
```

`module` (what an entry is) and `position` ("top" / "bottom"). Passed values are fixed and get no
control; missing ones come from the node's settings. `extra` — `(rows) => fragment` — adds
something below the list.

`cms.node.widget` is a file of the own module as usual; the relative import resolves from its URL,
since both modules are served under the same root.

## Replace by content

A container with a single block is an unnecessary wrapper. With exactly one entry the panel
offers to remove it: the child takes the container's place and `name` (so the parent's slot stays
filled), and the container is deleted. This is this module's `extra`
([pub/options.js](pub/options.js)), not part of the list panel — a menu must not replace itself
with its only group.

## Settings

| setting             | scope | meaning                                                     |
|---------------------|-------|-------------------------------------------------------------|
| `init-child-module` | site  | module of the first child a still-empty container creates    |
| `default module`    | node  | module of a new entry added in the panel                     |
| `add position`      | node  | `bottom` (default) or `top`                                  |

A new container is filled once with `init-child-module` (`__inited` remembers this, so emptying
it doesn't refill it), and the same module becomes its `default module`. It can be changed
afterwards.
