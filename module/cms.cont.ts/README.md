# cms.cont.ts

A content node rendered by its own TS file — like [cms.cont.html](../cms.cont.html/README.md),
for when a template is not enough.

```ts
// data/cms.cont.ts/12.ts
import type { NodeRender } from "jsr:@qino/qino/cms.cont.ts";

const render: NodeRender = async (node, { html, ctx, vars }) =>
  html.async`<div>${node.cms.text(node, "title", { tag: "h2" })}</div>`;

export default render;
```

`html` is passed in, not imported: the file is outside the project, so a runtime
import would be a fragile relative path or a second copy of core from jsr. The type
import is removed at load.

The file is imported with its mtime in the URL, so changes apply on the next
request. The default export's result (string or `HtmlString`) is rendered; without
a default export, edit mode shows a module error.

Files, creation and css/js work as in [cms.cont.html](../cms.cont.html/README.md);
see [codeFiles.ts](codeFiles.ts).

Only superusers can edit the file (via [fileEditor](../fileEditor/)) — it is code
with full app rights.
