# cms.cont.items

A list of equal entries — cards, teasers, staff, opening hours. The block holds the children,
the children hold the content, and one setting says what an entry is.

The successor of the old `cms.cont.items2`.

## Why the setting is the point

A container that takes anything leaves the editor in front of the whole module list, guessing
which one belongs in *this* list. Here the block already knows: `default module` is set once,
and "Add entry" creates exactly that — no picker, and nothing foreign between two entries.

That is also why the entries are managed in the options panel and not by dropping blocks onto
the page. The page shows the list; the panel decides what is in it.

## Settings

| setting          | meaning                                                              |
|------------------|----------------------------------------------------------------------|
| `default module` | module of a new entry (default `cms.cont.flexible`)                   |
| `add position`   | `bottom` (default) or `top` — where a new entry appears               |
| `width`          | `u2-width` (default) or empty — the site's content width, or the container's |

`cms.cont.flexible` holds anything, which is the right choice for a list whose entries differ.
A purpose-built module — a teaser, a person — keeps the list uniform and gives every entry the
same fields.

## The options panel

[pub/options.js](pub/options.js), the module's own widget, is items2' `options.php`:

- **Add entry** — creates a child with the module named below the list. The button stands where
  the entry will appear: under the list when entries are appended, above it when they are
  prepended. A menu grows at the end, a list of news at the beginning; `add position` says which,
  and a listing module fixes it with `readOnly` the same way it fixes `default module`.
- the entries as a sortable list: drag handle, title, module, settings, copy, delete
  (an entry without a title shows its module name, greyed)
- **Module of a new entry**, with the assignable content modules as a datalist

Every change redraws the block on the page (`cms.reloadNode`), so the panel and the page never
disagree. Reordering moves one entry at a time (`insert-before`), the way it did in items2.

## Reuse: a listing module borrows the panel

A module that renders its own children — a menu, a gallery — needs the same list, but nothing
of the rendering. It declares its widget as usual and lets the file pass this one through, with
what an entry is:

```ts
// plugin.ts
export const cms = { node: { render, widget: "pub/options.js" } };
```

```js
// pub/options.js — the whole file
import options, { css } from '../../cms.cont.items/pub/options.js';

export { css };
export default (widget, context) =>
  options(widget, { ...context, module: 'cms.cont.luca.menu.item', position: 'bottom' });
```

The widget is a function, so the caller hands it what is fixed: `module` — what an entry is —
and `position` ("top" / "bottom") — where a new one goes. Whatever is passed needs no setting
and gets no control; in a menu group an entry is a dish and the list grows at the end, always.
Whatever is left out comes from the node's settings and the editor decides, which is how
`cms.cont.items` itself uses it. Pass both, or the one you did not pass keeps its control.

And `cms.node.widget` keeps meaning what it means everywhere else: a file of this module. The
browser resolves the relative import from that file's own url; both modules are served under
the same root.

## What it renders

```html
<div qcms-mod="cont.items" class="u2-width">
  <div class="u2-grid">
    <div qcms-id="…">…</div>
  </div>
</div>
```

The grid is u2's, so a site restyles it with u2's own variables — the module only sets
`--u2-Items-width` and `--u2-Gap` ([pub/main.css](pub/main.css)).

An empty list creates its first entry, but only in edit mode: a visitor's page view must not
write to the database. items2 did it on every request.
