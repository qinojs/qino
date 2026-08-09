# cms.templateParser

Lets a CMS module render its node from a plain `template.html` instead of a
`render()` function. If a local or remote module contains `template.html` beside
its `plugin.ts`, this module hooks `cms.node.render`, parses the file and renders
it per request. Local templates are reparsed when their mtime changes; remote
templates are cached for the lifetime of the process like their imported plugin.

`renderTemplateFile(path, node)` from [mod.ts](mod.ts) does the same for any
other file — [cms.cont.html](../cms.cont.html/) renders one file per node with it.

Deliberately minimal: static HTML plus three constructs — no expressions, no
logic. Simple and safe, but built to be extended (`cms-if`, `cms-each`,
`{expr}` may come later).

The rule: a `cms-*` **attribute** (`cms-text`) keeps your tag as the wrapper;
a `<cms-*>` **element** (`<cms-image>`, `<cms-cont>`) is replaced by its output.

A full example: [cms.cont.example.ml/template.html](../../test-modules/cms.cont.example.ml/template.html)

Each example below shows the template form, then the equivalent in a plain
TS `render()` (see [cms/README.md](../cms/README.md)).

## `cms-text=name`

Editable text. The tag becomes the wrapper, other attributes are kept on it
and passed through as `cms.text` options — e.g. a bare `if` hides the element
for visitors while the text is empty.
The inner HTML is the initial content, stored in the app's default language.

```html
<h2 cms-text=title>Default <b>text</b> in default language</h2>
<div cms-text=main></div>
<p cms-text=note if></p>
```

```ts
return html.async`
  ${cms.text(node, "title", { tag: "h2", initial: "Default <b>text</b> in default language" })}
  ${cms.text(node, "main")}
  ${cms.text(node, "note", { tag: "p", if: true })}`;
```

## `<cms-image name=... />`

Editable image, rendered via `cms.image2`. All other attributes are passed
through as options (`width`/`height` become numbers, bare attributes become
`true`). With `localized`, each language has its own image (`cms.fileLang`).

```html
<cms-image name=image1 width=110 height=110 fit=contain />
<cms-image name=logo width=110 height=110 localized />
```

```ts
const image1 = await node.file("image1");
const logo   = await cms.fileLang(node, "logo");
return html.async`
  ${cms_image2(image1, { width: 110, height: 110, fit: "contain", if: 1 })}
  ${logo && cms_image2(logo, { width: 110, height: 110, if: 1 })}`;
```

## `<cms-cont name=... />`

Embeds a sub-content node, created on first render. `module=` (alias
`default-module=`) sets the module used at creation; an existing cont keeps
its own module. Default: `cms.cont.flexible`.

```html
<cms-cont name=body module=cms.cont.text />
```

```ts
return html.async`${node.cont("body", "cms.cont.text")}`;
```

## `node=` — target another node

All constructs work on the current node by default. `node=` redirects them:

| value                 | resolves to                                          |
|-----------------------|------------------------------------------------------|
| `page`                | the enclosing page — `node.page()`                   |
| `layout`              | the global layout page — `cms.layoutPage(module)`    |
| `parent`, `parent(2)` | ancestor — `node.parent(2)`                          |
| a number              | that node id — `cms.node(5)`                         |

```html
<h1 cms-text=title node=page></h1>
<cms-cont name=nav node=layout />
```

```ts
const page   = await node.page();
const layout = await cms.layoutPage(page.module.name);
return html.async`
  ${cms.text(page, "title", { tag: "h1" })}
  ${layout.cont("nav")}`;
```

## Notes

- The template must have **exactly one root element** (`qcms-id` is injected
  into the first tag, see [cms/README.md](../cms/README.md)).
- Comments are stripped; everything else passes through as written.
- In edit mode images become editable (`dbfile-editable`); missing images
  render nothing for visitors.
- Typos don't fail silently: unknown `cms-*` elements/attributes and missing
  `name=` log a warning in dev and edit mode.

## Ideas (not implemented)

- `{setting.color}` / `{lang}` / `{url}` — plain dot-path lookups in text and
  attributes; no JS expressions, just escaped property access.
- `<a cms-link=32>` — stable internal links, `href` from the target's
  `node.url()`; value syntax shared with `node=`.
- `<a cms-file=flyer>` — download links, editable in edit mode like images.
- `cms-if` / `cms-each` — only once a real module needs them.
