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
  name: "starter.account: adds the account area with the login, on top of starter.cms",
  ...quiet,
  fn: async () => {
    const dir = await Deno.makeTempDir() + "/";
    const app = new App({ dir, db: `sqlite:${dir}site.sqlite` });
    app.stores.add(import.meta.resolve("../../store.json")).add("cms").add("starter.account");
    await app.init();
    try {
      const cm = cms(app);
      for (const name of ["account", "profile", "security", "home", "login"]) {
        assertEquals((await cm.nodesByName(name)).size, 1, name);
      }
      const account = await app.fetch(new Request("http://localhost/en/my-account"));
      assert((await account.text()).includes("data-action=login"), "the account page offers passkey login");

      const res = await app.fetch(new Request("http://localhost/en/my-account/security"));
      assertEquals(res.status, 200);
      assert((await res.text()).includes("Please sign in"), "guests are asked to sign in");
      const [emails] = (await cm.nodesByModule("cms.cont.my.emails")).values();
      assertEquals(await emails.settings.single, true, "one address by default");
      assertEquals(await (await cm.nodeByModule("cms.cont.privacy"))!.settings.account, true, "the privacy policy covers accounts");
      assertEquals((await cm.nodesByModule("cms.cont.my.password")).size, 1);
      const pages = await (await cm.node(1)).children({ type: "p" });
      const menu = pages.values().filter((p) => p.vs.visible).map((p) => p.vs.name);
      assertEquals([...menu], ["home", "contact", "account", "first-steps"]);
      await app.modules.repair("starter.account");
      assertEquals((await cm.nodesByModule("cms.cont.login")).size, 3, "login, no-access, account");
    } finally {
      await app.db.close();
      await Deno.remove(dir, { recursive: true });
    }
  },
});
