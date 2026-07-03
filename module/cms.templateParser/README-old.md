# cms.templateParser

Lets a CMS module render its node from a plain `template.html` instead of a
`render()` function. If a module directory contains `template.html`, this module
hooks `cms.node.render`, parses the file once (cached, hot-reloaded on change)
and renders it per request. `cms-part` sections are exposed as
`plugin.cms.node.parts[name]`, so `cms.reloadPart()` works as usual.

A full example: [cms.cont.example.ml/template.html](../cms.cont.example.ml/template.html)

Each example below shows the template form, then the equivalent in a plain
TS `render()` (see [cms/README.md](../cms/README.md)). The TS snippets assume:

```ts
import { html, HtmlString, getCtx } from "../core/mod.ts";
import { cms_image2 } from "../cms.image2/mod.ts";

async function render(node: Node): Promise<HtmlString> {
  const cms = node.cms;
  // …
}
```

## Expressions: `{expr}`

Any JS expression, in text and in attribute values. Output is HTML-escaped;
promises are awaited. Errors evaluate to `""`.

```html
<span class="lang-{lang}">Language: {lang}</span>
<small>{(new Date()).toISOString()}</small>
<div style="background:{setting.color ?? 'transparent'}">
```

```ts
const lang = getCtx().lang;
return html.async`
  <span class="lang-${lang}">Language: ${lang}</span>
  <small>${new Date().toISOString()}</small>
  <div style="background:${node.settings.color() ?? "transparent"}">…</div>`;
```

Available in every expression:

| name        | value                                        |
|-------------|----------------------------------------------|
| `setting.*` | node setting (`setting.color`, `""` if unset) |
| `node`      | the CMS node                                  |
| `url`       | `await node.url()`                            |
| `lang`      | current request language                      |
| `files`     | `await node.files()`                          |
| `conts`     | `await node.conts()`                          |
| …           | loop variables and `vars` passed to `render`  |

## `cms-if="expr"`

Render the element only if the expression is truthy. Checked before all other
`cms-*` attributes, so it combines with them.

```html
<p cms-if="setting.note"><em>{setting.note}</em></p>
```

```ts
const note = node.settings.note();
return html.async`${note ? html`<p><em>${note}</em></p>` : ""}`;
```

## `cms-each="iterable as name"`

Repeats the element itself once per item. Iterable is a JS expression
(array, Map → values, plain object → values) or a numeric range `from..to`.
Inside the loop, `name` and `nameIndex` are in scope.

```html
<li cms-each="files as file">{file.name} ({fileIndex})</li>
<img cms-each="1..3 as i" cms-image="gallery_{i}" width=200 />
```

```ts
const files = Object.values(await node.files());
const lis = files.map((file, i) => html`<li>${file.name} (${i})</li>`).join("");

let imgs = "";
for (let i = 1; i <= 3; i++) {
  const file = await cms.fileLang(node, `gallery_${i}`);
  if (file) imgs += await cms_image2(file, { width: 200 });
}
return html.async`<ul>${new HtmlString(lis)}</ul> ${new HtmlString(imgs)}`;
```

## `cms-text=name`

Editable text content, stored per language. The tag becomes the wrapper.
Language attributes (`de`, `en`, `fr`, …) are initial values.

```html
<h2 cms-text=title de="Titel" en="Title" />
<div cms-text=main de="Text hier..." en="Text here..." />
```

```ts
return html.async`
  ${cms.text(node, "title", { tag: "h2", initial: { de: "Titel", en: "Title" } })}
  ${cms.text(node, "main", { initial: { de: "Text hier...", en: "Text here..." } })}`;
```

## `cms-image=name`

Editable image, rendered via `cms.image2`. The name may contain expressions.
All other attributes are passed through as options (`width`/`height` become
numbers, valueless attributes become `true`). `:file="expr"` uses a db file
directly instead of looking it up by name.

```html
<img cms-image=image1 width=110 height=110 fit=contain />
<img cms-image=_ :file="file" width=60 height=60 />
```

```ts
const image = await cms.fileLang(node, "image1");
return html.async`
  ${image && cms_image2(image, { width: 110, height: 110, fit: "contain" })}
  ${file && cms_image2(file, { width: 60, height: 60 })}`;
```

## `cms-cont=name`

Embeds a sub-content node, created on first render. `module=` (alias
`default-module=`) sets the module used at creation; an existing cont keeps
its own module. Default: `cms.cont.flexible`.

```html
<div cms-cont=body module=cms.cont.text />
```

```ts
return html.async`<div>${node.cont("body", "cms.cont.text")}</div>`;
```

## `cms-part=name`

Names a reloadable fragment. The attribute stays in the output so
`cms.reloadPart(nid, name, vars)` can find and replace it.

```html
<div cms-part=teaser>
  <h2 cms-text=teaser />
  <small>{(new Date()).toISOString()}</small>
</div>
```

```ts
function teaser(node: Node): Promise<HtmlString> {
  return html.async`
    ${node.cms.text(node, "teaser", { tag: "h2" })}
    <small>${new Date().toISOString()}</small>`;
}

// in render():  html.async`<div cms-part=teaser>${teaser(node)}</div>`
// in plugin.ts: export const cms = { node: { render, parts: { teaser } } };
```

## Notes

- Templates are trusted module code — expressions run with full JS power.
- Expression output and attribute values are escaped; there is no raw-HTML
  output construct.
- Standard HTML applies: comments are stripped, void elements and `/>` work,
  attribute values may be unquoted.
