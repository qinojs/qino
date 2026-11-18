import { test } from "node:test";
import { App, Ctx, fs, getCtx, requestStorage, runAs } from "@qino/qino";
import { cms, cmsCtx } from "@qino/qino/cms";
import { assert, assertEquals, assertStringIncludes } from "@qino/qino/tests";

test("localized uploads only replace the shared image in their own language", async () => {
  const dir = await fs.tempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms").add("cms.cont.image");
  try {
    await app.init();
    app.languages.setLangs(["en", "fr", "de"]);
    await app.settings.core.url("https://qino.test/");
    const page = await (await cms(app).node(1)).createChild({ access: 1 });
    const node = await page.createCont({ module: "cms.cont.image" });
    const svg = (id: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2" id="${id}"/>`;
    await node.addFile(await app.dbFiles.add(new File([svg("shared-image")], "shared.svg", { type: "image/svg+xml" })));
    const [shared] = (await node.files()).keys();
    const ctx = await Ctx.create(app, new Request("https://qino.test/"), { appUrl: "/" });
    ctx.sess = await app.sessions.load();
    const render = (lang: string) => requestStorage.run(ctx, async () => {
      ctx.lang = lang;
      return String(await node.htmlRaw());
    });

    for (const lang of app.languages.all) assertStringIncludes(await render(lang), "shared-image");
    assertEquals([...(await node.filesAndPlaceholders()).keys()], [shared]);

    const admin = Number(await app.db.table("usr").insert({ username: "admin", active: true, superuser: true }));
    await runAs(app, admin, "test", async () => {
      const ctx = getCtx();
      ctx.lang = "fr";
      cmsCtx(ctx).editmode = 1;
      assertStringIncludes(String(await node.htmlRaw()), "shared-image");
    });
    assertEquals([...(await node.filesAndPlaceholders()).keys()].sort(), [shared, "image de", "image en", "image fr"].sort());
    const french = await node.file("image fr");
    await french.replaceBy("data:image/svg+xml," + encodeURIComponent(svg("french-image")));

    assertStringIncludes(await render("fr"), "french-image");
    for (const lang of ["en", "de"]) {
      const out = await render(lang);
      assertStringIncludes(out, "shared-image");
      assert(!out.includes("french-image"));
    }
    await node.deleteFile(shared);
    assert(!(await render("de")).includes("<cms-image"));
    assertStringIncludes(await render("fr"), "french-image");
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await fs.remove(dir, { recursive: true });
  }
});
