# cms.cont.html

A content node whose markup is in its own file, rendered by
[cms.templateParser](../cms.templateParser/README.md) — plain HTML, optionally
with `cms-text` / `cms-link` / `<cms-image>` / `<cms-cont>`.

Files of node `12`, below the app directory:

| file                            | served as                    |
|---------------------------------|------------------------------|
| `data/cms.cont.html/12.html`    | — (the source, never served) |
| `data/cms.cont.html/pub/12.css` | `d/cms.cont.html/pub/12.css` |
| `data/cms.cont.html/pub/12.js`  | `d/cms.cont.html/pub/12.js`  |

The HTML file is created with starter content when the node is rendered in edit mode or opened;
its examples are commented out. CSS and JS are created when opened in the panel or via the API,
and are only linked while they exist (JS as module script). Superusers edit all three in the
options panel via [fileEditor](../fileEditor/); changes apply on the next request.

Paths and creation: [codeFiles.ts](codeFiles.ts); `data/<module>/` is the module's data directory
([Module.data](../core/lib/ModuleManager.ts)).
[cms.cont.ts](../cms.cont.ts/README.md) is the same idea with a TS file instead.
