# cms.cont.ts

A content node rendered by its own TS file — [cms.cont.html](../cms.cont.html/README.md)
for cases where a template is not enough.

```ts
// qg/cms.cont.ts/12.ts
import type { NodeRender } from "jsr:@qino/qino/cms.cont.ts";

const render: NodeRender = async (node, { html, ctx, vars }) =>
  html.async`<div>${node.cms.text(node, "title", { tag: "h2" })}</div>`;

export default render;
```

`html` is handed in rather than imported: the file lives outside the project, so
any runtime import would either be a brittle relative path or a second copy of
core from jsr. The type import costs nothing — it is erased at load.

The file is imported dynamically, with its mtime busting the ESM cache, so a
saved file takes effect with the next request. It renders whatever its default
export returns — a string or an `HtmlString`; without a default export the node
shows a module error in edit mode.

Files, creation and the css/js next to it work exactly as in
[cms.cont.html](../cms.cont.html/README.md); see [codeFiles.ts](codeFiles.ts).

Only superusers can edit the file (through [fileEditor](../fileEditor/)) — it is
code, it runs with everything the app can do.
