# cms.templateParser

Lets a CMS module render its node from a `template.html` instead of a `render()`
function. If a module has `template.html` next to its `plugin.ts`, this module
provides `cms.node.render` from it. Local templates are reparsed when they change;
remote templates are cached for the process lifetime, like their plugin.

`renderTemplateFile(path, node)` from [mod.ts](mod.ts) does the same for any
other file — [cms.cont.html](../cms.cont.html/) renders one file per node with it.

Deliberately minimal: static HTML, four constructs and declared
`{{placeholders}}` — no expressions or logic.

Rule: a `cms-*` **attribute** (`cms-text`) keeps your tag as the wrapper; a
`<cms-*>` **element** (`<cms-image>`, `<cms-cont>`) is replaced by its output.

A full example: [cms.cont.example.ml/template.html](../../test-modules/cms.cont.example.ml/template.html)

Each example shows the template, then the same as TS `render()` (see
[cms/README.md](../cms/README.md)).

## `cms-text=name`

Editable text. The tag is the wrapper; other attributes stay on it and are
passed as `cms.text` options — e.g. `if` hides the element for visitors while the
text is empty. The inner HTML is the initial content in the default language.

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

Editable image via `cms.image2`. Other attributes are passed as options
(`width`/`height` as numbers, bare attributes as `true`). With `localized`, each
language has its own image (`cms.fileLang`).

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

Embeds a child node, created on first render. `module=` (alias `default-module=`)
sets its module on creation; an existing node keeps its module. Default:
`cms.cont.flexible`.

```html
<cms-cont name=body module=cms.cont.text />
```

```ts
return html.async`${node.cont("body", "cms.cont.text")}`;
```

## `cms-link=...`

Internal link by node. The target uses the `node=` syntax below. The CMS link
attributes (`href`, state classes, `aria-current`, edit marker, `target`) are
added to the wrapper. A template class is prepended, a template `target` wins,
`href` always comes from the CMS. An empty wrapper gets the target's title.

```html
<a cms-link=32 class=card>About us</a>
<a cms-link=page></a>
```

```ts
const target = await cms.node(32);
const page = await node.page();
await cms.linkAttributes(target);
// { href: "/en/about-us", class: "cmsLink32 ...", target: "...", ... }
return html.async`${cms.link(page)}`;
```

`CMS.linkAttributes()` returns the attributes; the template merges them into the
wrapper. Combine `cms-link` with `cms-text` on the same tag for an editable label.

## `node=` — target another node

All constructs work on the current node by default. `node=` redirects them:

| value                 | resolves to                                          |
|-----------------------|------------------------------------------------------|
| `page`                | the enclosing page — `node.page()`                   |
| `layout`              | the global layout page — `cms.layoutPage(module)`    |
| `parent`              | direct parent — `node.parent()`                       |
| `parent(2)`           | ancestor at absolute tree level 2 — `node.parent(2)`  |
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
- Unknown `cms-*` elements/attributes and missing `name=` log a warning in dev
  and edit mode.

## `{{placeholder|fallback}}`

Modules can export `templatePlaceholders`; keys are prefixed with the module
name. Only those names are resolved, once per node. They work in text and
attribute values. A placeholder returns `{ text }` (escaped); an additional
`html` (must be `html.raw()`) is used in text nodes only. Content rendered by
`cms-text`, `cms-cont` etc. is never parsed again. Unknown names warn in dev
and edit mode.

```html
<a href="tel:{{identity.contact.telephone}}">
  {{identity.contact.telephone|Telephone}}
</a>
```

## Ideas (not implemented)

- `<a cms-file=flyer>` — download links, editable in edit mode like images.
- `cms-if` / `cms-each` — only once a real module needs them.

## `moduleTemplate(module)`

A layout module ships its `template.html` as a *starting point*: on the first
render in edit mode the site gets a copy in `data/<module>/`, which is used from
then on; if deleted, the shipped one is used again.
[moduleTemplate.ts](moduleTemplate.ts) has the paths, the copy step and the
options panel (`layoutOptions`) with fileEditor links.
[cms.layout.standard.1](../cms.layout.standard.1/README.md) and
[cms.layout.deck.1](../cms.layout.deck.1/README.md) use it — little more than a
template plus a css file.
