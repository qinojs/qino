# cms.cont.html

A content node whose markup lives in its own file, rendered through
[cms.templateParser](../cms.templateParser/README.md) — plain HTML plus the
`cms-text` / `cms-link` / `<cms-image>` / `<cms-cont>` constructs. Without
those it is just HTML, so the module covers both.

Files of node `12`, below the app directory:

| file                            | served as                    |
|---------------------------------|------------------------------|
| `data/cms.cont.html/12.html`    | — (the source, never served) |
| `data/cms.cont.html/pub/12.css` | `d/cms.cont.html/pub/12.css` |
| `data/cms.cont.html/pub/12.js`  | `d/cms.cont.html/pub/12.js`  |

HTML is created with its initial content on rendering in edit mode or opening. CSS and JS are
created individually when opened in the panel or through the API. The HTML
examples are commented out until you need them. css and js are linked only while they exist, the js as a module
script. Superusers edit all three from the options panel via
[fileEditor](../fileEditor/), and a saved file takes effect with the next
request.

Paths and creation live in [codeFiles.ts](codeFiles.ts); `data/<module>/` is what the
app keeps for a module ([Module.data](../core/lib/ModuleManager.ts)).
[cms.cont.ts](../cms.cont.ts/README.md) is the same idea with a TS file instead.
