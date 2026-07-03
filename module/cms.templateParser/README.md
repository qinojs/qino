# cms.templateParser


keine expressions, code soll einfach und sicher sein

## `cms-if="expr"`

if vorerst nicht, vieleicht später

## `cms-each="iterable as name"`

keine iterable

## `cms-text=name`

erst mal nur default lang und den html inhalt gleich als default

```html
<h2 cms-text=title>Default <b>Text</b> in default language</h2>
<div cms-text=main/>
```

## `cms-image=name`

Editable image, rendered via `cms.image2`. The name may contain expressions.
All other attributes are passed through as options (`width`/`height` become
numbers, valueless attributes become `true`).

```html
<cms-image name=image1 width=110 height=110 fit=contain localized />
<cms-image name=image2 width=110 height=110 />
```
achtung fileLang nur bei localized

```ts
const image1 = await cms.fileLang(node, "image1");
const image2 = await node.file("image2");

return html.async`
  ${image1 && cms_image2(image1, { width: 110, height: 110, fit: "contain" })}
  ${image2.exists() && cms_image2(image2, { width: 60, height: 60 })}`;
```

## `cms-cont=name`


```html
<cms-cont name=body module=cms.cont.text />
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
  <small>test</small>
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

