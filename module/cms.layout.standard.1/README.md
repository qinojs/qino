# cms.layout.standard.1

A frontend layout that is nothing but an HTML template, rendered through
[cms.templateParser](../cms.templateParser/README.md). Header with logo and
navigation, main, footer — the parts that every site has.

The module ships [template.html](template.html) as a starting point. On the
first render in edit mode the site gets its own copy and edits it from there:

| file                                          | role                                  |
|-----------------------------------------------|---------------------------------------|
| `template.html` (in the module)               | the shipped template, fallback        |
| `data/cms.layout.standard.1/template.html`    | the site's copy — wins while it exists|
| `data/cms.layout.standard.1/pub/main.css`     | the site's styles, linked by cms      |

Both are edited from the options panel via [fileEditor](../fileEditor/); a saved
file takes effect with the next request. Delete the copy and the shipped
template renders again.

Global parts (`nav`, `foot`) live on the layout page — `node=layout` in the
template — so they are edited once for the whole site, while `main` is the
content of each page.

[pub/main.css](pub/main.css) is built entirely from the
[u2](https://github.com/u2ui/u2) variables, so the site's css needs to change
little to look different — `--color` alone repaints everything. The variables
worth touching are already in the created file.

Paths, the site's copy and the options panel come from
[cms.templateParser/moduleTemplate.ts](../cms.templateParser/moduleTemplate.ts),
which every layout built on a template shares.
[cms.layout.deck.1](../cms.layout.deck.1/README.md) is the second one;
[cms.layout.claude1](../cms.layout.claude1/) is the same idea with a `render()`
function instead of a template.
