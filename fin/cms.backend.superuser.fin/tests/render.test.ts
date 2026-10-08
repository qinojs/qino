import { assertStringIncludes } from "@std/assert";
import { create, issue } from "@qino/qino/fin.invoice";

import { backendNode, inRequest, withFinApp } from "../../tests/app.ts";
import { cms } from "../plugin.ts";

const FIN = ["fin.payment", "fin.bank", "fin.payment.qrbill", "fin.invoice"];

Deno.test("the overview shows what is open and lists the linked parts with what they build on", async () => {
  await withFinApp(FIN, async (app) => {
    await issue(app, await create(app, { currency: "CHF", lines: [{ name: "Design", price: 10000 }], due: "2020-01-01" }));
    const node = backendNode(app, "/backend/fin"); // without sub-pages, the dashboard stays empty
    const page = String(await inRequest(app, "http://qino.test/backend/fin", () => cms.node.render(node)))
      .replaceAll("\u00a0", " "); // Intl keeps "CHF" and the amount together
    for (const part of [
      "CHF 100.00", // receivable
      '<small class=u2-badge style="background:var(--red)">1</small>', // overdue
      "<code>fin.payment.qrbill</code>",
      "payment provider",
      "<code>fin.bank</code> <code>fin.payment</code>", // what qrbill builds on
      "fin.invoice:7",
    ]) assertStringIncludes(page, part);
  });
});
