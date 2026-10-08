import { assert } from "@std/assert";
import { toTools } from "@qino/qino";

import { withFinApp } from "./app.ts";

const FIN = [
  "fin.payment", "fin.invoice", "fin.bank", "fin.bank.camt", "fin.payment.credit", "fin.subscription",
  "fin.accounting", "fin.accounting.ch",
];

Deno.test("every fin api becomes tools, each of its own name", async () => {
  await withFinApp(FIN, async (app) => {
    // as the app mounts them; throws where a list and an item of it, or two routes, would share a name
    const tree = Object.fromEntries(Object.entries(app.apiTree).filter(([name]) => /^fin(\.|$)/.test(name)));
    assert(Object.keys(tree).length === FIN.length + 1); // and fin itself
    assert(toTools(tree).length > 30);
  });
});
