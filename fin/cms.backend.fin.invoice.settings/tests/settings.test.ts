import { test } from "node:test";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { create, document } from "@qino/qino/fin.invoice";

import { backendNode, inRequest, withFinApp } from "../../tests/app.ts";
import { cms } from "../plugin.ts";

test("the page shows the settings and saves the CSS the document is printed with", async () => {
  await withFinApp(["fin.payment", "fin.invoice"], async (app) => {
    const node = backendNode(app, "/backend/invoices/settings");
    await inRequest(app, "https://shop.test/backend/invoices/settings", async () => {
      assertStringIncludes(String(await cms.node.render(node)), 'source="/api/core/settings/fin.invoice"');
      assertEquals(await cms.node.api(node, { css: "td > b { color: red }" }), { ok: true });
      assertStringIncludes(String(await cms.node.render(node)), "td &gt; b { color: red }");
      // in the document as written, and it cannot leave the style element
      const id = await create(app, { currency: "CHF", lines: [{ name: "Design", price: 100 }] });
      assertStringIncludes(await document(app, id), "td > b { color: red }\n</style>");
      await cms.node.api(node, { css: "</style><script>" });
      assertEquals((await document(app, id)).includes("</style><script>"), false);
    });
  });
});
