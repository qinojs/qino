import { App } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { assert, assertEquals } from "@qino/qino/tests";

import manifest from "../manifest.json" with { type: "json" };

const quiet = { sanitizeOps: false, sanitizeResources: false };

Deno.test("starter.fin: every module it brings is in a store", async () => {
  const names = async (url: string) => Object.keys(JSON.parse(await Deno.readTextFile(new URL(url, import.meta.url))).modules);
  const offered = new Set([...await names("../../store.json"), ...await names("../../../module/store.json")]);
  assertEquals(manifest.dependencies.filter((mod) => !offered.has(mod)), []);
});

Deno.test({
  name: "starter.fin: the customer's invoices and address in the account area",
  ...quiet,
  fn: async () => {
    const dir = await Deno.makeTempDir() + "/";
    const app = new App({ dir, db: `sqlite:${dir}site.sqlite` });
    app.stores.add(import.meta.resolve("../../../module/store.json")).add("cms");
    app.stores.add(import.meta.resolve("../../store.json")).add("starter.fin");
    await app.init();
    try {
      const account = (await cms(app).nodesByName("account")).values().next().value!;
      assertEquals((await cms(app).nodesByName("todo-fin")).size, 1, "an item on the checklist");
      for (const name of ["invoices", "address"]) {
        const p = (await cms(app).nodesByName(name)).values().next().value!;
        assert(p && await p.in(account), name);
      }
      const below = (await account.children({ type: "p" })).values().map((p) => p.vs.name);
      assertEquals([...below], ["invoices", "address", "passkeys", "two-factor", "devices"]);
      const res = await app.fetch(new Request("http://localhost/en/my-account/invoices"));
      assertEquals(res.status, 200);
      await res.body?.cancel();
      assert(await cms(app).nodeByModule("cms.backend.superuser.fin.invoice"), "the backend page is there");
    } finally {
      await app.db.close();
      await Deno.remove(dir, { recursive: true });
    }
  },
});
