# cms.cont.flexible

A container that holds anything: its children are the content, in the order the editor put them.
The plainest container there is — and therefore the place where the shared list panel lives.

## The list panel

[pub/list.js](pub/list.js) is the panel every container with children uses: the entries as a
sortable list (drag handle, title, module, settings, copy, delete), "Add entry", and the two
settings that say what a new entry is (`default module`) and where it appears (`add position`).
Every change redraws the block on the page, so panel and page never disagree.

It sits here and not in a rendering module because a menu or a gallery wants the list and none
of the rendering. `cms.cont.items` borrows it unchanged; this module adds one thing of its own.

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

`module` — what an entry is — and `position` ("top" / "bottom") — where a new one goes. Whatever
is passed needs no setting and gets no control; whatever is left out comes from the node's
settings and the editor decides. `extra` — `(rows) => fragment` — adds what the host has to say
about the container itself, below the list.

And `cms.node.widget` keeps meaning what it means everywhere else: a file of this module. The
browser resolves the relative import from that file's own url; both modules are served under the
same root.

## Replace by content

A container holding a single block is a wrapper nobody asked for. With exactly one entry the
panel offers to step aside: the child moves into the container's place, takes over its `name` so
the parent's slot keeps its filling, and the container is deleted. That is this module's `extra`
([pub/options.js](pub/options.js)) — a menu must not replace itself by its only group, so it
stays out of the list panel.

## Settings

| setting             | scope | meaning                                                     |
|---------------------|-------|-------------------------------------------------------------|
| `init-child-module` | site  | module of the first child a still-empty container creates    |
| `default module`    | node  | module of a new entry added in the panel                     |
| `add position`      | node  | `bottom` (default) or `top`                                  |

The site-wide seed fills a fresh container once — `__inited` remembers it, so emptying the
container does not bring it back — and writes the same module into the container's own
`default module` on the way, which is what the panel's picker then offers. Born with the site's
module, free to diverge afterwards.
