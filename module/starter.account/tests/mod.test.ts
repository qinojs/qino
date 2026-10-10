import { App } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { assert, assertEquals } from "@qino/qino/tests";

import manifest from "../manifest.json" with { type: "json" };

const quiet = { sanitizeOps: false, sanitizeResources: false };

Deno.test("starter.account: every module it brings is in the store", async () => {
  const catalog = JSON.parse(await Deno.readTextFile(new URL("../../store.json", import.meta.url)));
  assertEquals(manifest.dependencies.filter((mod) => !catalog.modules[mod]), []);
});

Deno.test({
  name: "starter.account: adds the account area and passkeys on the login page, on top of starter.cms",
  ...quiet,
  fn: async () => {
    const dir = await Deno.makeTempDir() + "/";
    const app = new App({ dir, db: `sqlite:${dir}site.sqlite` });
    app.stores.add(import.meta.resolve("../../store.json")).add("cms").add("starter.account");
    await app.init();
    try {
      const cm = cms(app);
      for (const name of ["account", "passkeys", "two-factor", "devices", "home", "login", "todo-passkeys"]) {
        assertEquals((await cm.nodesByName(name)).size, 1, name);
      }
      const passkey = await cm.nodeByModule("cms.cont.webauthn");
      const login = (await cm.nodesByName("login")).values().next().value!;
      assert(passkey && await passkey.in(login), "passkeys sit on the login page");

      const res = await app.fetch(new Request("http://localhost/en/my-account/passkeys"));
      assertEquals(res.status, 200);
      assert((await res.text()).includes("Please sign in"), "guests are asked to sign in");
      const pages = await (await cm.node(1)).children({ type: "p" });
      const menu = pages.values().filter((p) => p.vs.visible).map((p) => p.vs.name);
      assertEquals([...menu], ["home", "contact", "account", "first-steps"]);
      await app.modules.repair("starter.account");
      assertEquals((await cm.nodesByModule("cms.cont.webauthn")).size, 1);
    } finally {
      await app.db.close();
      await Deno.remove(dir, { recursive: true });
    }
  },
});
