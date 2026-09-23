# cms.cont.items

A list of similar entries — cards, teasers, staff, opening hours. One setting defines what an
entry is.

The successor of the old `cms.cont.items2`.

## Why the setting is the point

A container that takes anything shows the editor the whole module list. Here `default module` is
set once, and "Add entry" creates exactly that — no picker, no foreign entries.

That's why entries are managed in the options panel, not by dropping blocks onto the page.

## Settings

| setting          | meaning                                                              |
|------------------|----------------------------------------------------------------------|
| `default module` | module of a new entry (default `cms.cont.flexible`)                   |
| `add position`   | `bottom` (default) or `top` — where a new entry appears               |
| `width`          | `u2-width` (default) or empty — the site's content width, or the container's |

`cms.cont.flexible` suits entries that differ. A dedicated module (a teaser, a person) keeps all
entries uniform.

## The options panel

The list panel comes from [cms.cont.flexible](../cms.cont.flexible/README.md).
[pub/options.js](pub/options.js) re-exports it unchanged; `default module` and `add position` stay
editable.

## What it renders

```html
<div qcms-mod="cont.items" class="u2-width">
  <div class="u2-grid">
    <div qcms-id="…">…</div>
  </div>
</div>
```

The grid is u2's, styled with u2 variables — the module only sets `--u2-Items-width` and
`--u2-Gap` ([pub/main.css](pub/main.css)).

An empty list creates its first entry, but only in edit mode: a visitor's page view must not write
to the database.
