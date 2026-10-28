import { App, Ctx, requestStorage } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { assert, assertEquals } from "@qino/qino/tests";

Deno.test("cms.cont.imprint/privacy: owner from identity, switchable sections, editable texts", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms.cont.imprint").add("cms.cont.privacy");
  await app.init();
  try {
    const { identity } = app.settings;
    await identity.organization.legalName("Muster AG");
    await identity.organization.address.streetAddress("Bahnhofstrasse 1");
    await identity.organization.address.postalCode("8001");
    await identity.organization.address.addressLocality("Zürich");
    await identity.organization.address.addressCountry("CH");
    await identity.contact.email("info@muster.test");

    const root = await cms(app).node(1);
    const ctx = await Ctx.create(app, new Request("http://qino.test/"), { appUrl: "/" });
    ctx.sess = await app.sessions.load();
    ctx.lang = app.languages.def;
    await requestStorage.run(ctx, async () => {
      const page = await root.createChild({ access: 1 });
      const imprint = await page.createCont({ module: "cms.cont.imprint" });
      const privacy = await page.createCont({ module: "cms.cont.privacy" });
      let out = String(await imprint.htmlRaw());
      for (const part of ["Muster AG", "8001 Zürich", "Switzerland", 'href="mailto:info@muster.test"', "Copyright"]) {
        assertEquals(out.includes(part), true, part);
      }
      assertEquals(out.includes("Commercial register"), false, "off by default");
      assert(out.indexOf('qcms-name="more"') < out.indexOf("Liability for content"), "credits go below the owner");

      await imprint.settings.owner(false);
      assert(String(await imprint.htmlRaw()).includes('qcms-name="more"'), "the free area stays with its section off");
      await imprint.settings.owner(true);
      await imprint.settings.copyright(false);
      await imprint.settings.register(true);
      await identity.organization.address.addressLocality("Bern");
      out = String(await imprint.htmlRaw());
      assertEquals([out.includes("Copyright"), out.includes("Commercial register"), out.includes("8001 Bern")],
        [false, true, true]);

      await imprint.text("disclaimer", ctx.lang, "<p>Own words</p>");
      out = String(await imprint.htmlRaw());
      assertEquals([out.includes("Own words"), out.includes("Liability for content")], [true, false], "edits stay");

      out = String(await privacy.htmlRaw());
      assertEquals([out.includes("Muster AG"), out.includes("GDPR"), out.includes("User account")], [true, true, false]);
    });
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  }
});
