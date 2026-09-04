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

The list panel itself lives in [cms.cont.flexible](../cms.cont.flexible/README.md) — the plainest
container there is, so a module can borrow the list without the grid. Items fixes nothing:
[pub/options.js](pub/options.js) re-exports it, and `default module` and `add position` stay the
editor's choice.

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
