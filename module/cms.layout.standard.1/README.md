# cms.layout.standard.1

A frontend layout that is just an HTML template, rendered by
[cms.templateParser](../cms.templateParser/README.md): header with logo and
navigation, main, footer.

The module ships [template.html](template.html) as a starting point; on the first
render in edit mode the site gets its own copy:

| file                                          | role                                  |
|-----------------------------------------------|---------------------------------------|
| `template.html` (in the module)               | the shipped template, fallback        |
| `data/cms.layout.standard.1/template.html`    | the site's copy — wins while it exists|
| `data/cms.layout.standard.1/pub/main.css`     | the site's styles, linked by cms      |

Both are edited in the options panel via [fileEditor](../fileEditor/); changes
apply on the next request. Delete the copy to get the shipped template back.

Global parts (`nav`, `foot`) are on the layout page (`node=layout`), so they are
edited once for the whole site; `main` is each page's content.

[pub/main.css](pub/main.css) uses only [u2](https://github.com/u2ui/u2)
variables — `--color` alone changes the whole look. Color and font come from
[identity](../identity/mod.ts), written into the head before all stylesheets; the
site's css overrides them by setting the same variable. The useful ones are in
the created file, commented out.

Paths, the site's copy and the options panel come from
[cms.templateParser/moduleTemplate.ts](../cms.templateParser/moduleTemplate.ts),
shared by all template layouts.
[cms.layout.deck.1](../cms.layout.deck.1/README.md) is the second one;
[cms.layout.claude1](../cms.layout.claude1/) is the same idea with a `render()`
function instead of a template.
