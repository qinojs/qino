import { test } from "node:test";
import { App, fs, getCtx, runAs } from "@qino/qino";
import { cms, cmsCtx } from "@qino/qino/cms";
import { assert, assertStringIncludes } from "@qino/qino/tests";

test("the seo tree edits title, description and share values where the user may", async () => {
  const dir = await fs.tempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms.backend.cms.tree.seo").add("cms.layout.standard.2");
  await app.init();
  await app.settings.core.url("https://qino.test/");
  try {
    const root = await cms(app).node(1);
    const page = await root.createChild({ access: 1, searchable: true });
    await page.title("en", "About");
    await page.text("_description", "en", "Too short");
    await page.text("_share_title", "en", "Meet us & more");
    const tree = await root.createCont({ module: "cms.backend.cms.tree.seo" });
    const admin = Number(await app.db.table("usr").insert({ username: "admin@example.test", active: 1, superuser: 1 }));
    const out = String(await runAs(app, admin, "test", () => {
      cmsCtx(getCtx()).editmode = 1;
      return tree.html();
    }));
    assertStringIncludes(out, "About <small>(5 characters, !)</small>");
    assertStringIncludes(out, "Too short <small>(9 characters, !)</small>");
    assertStringIncludes(out, "Meet us &amp; more");
    assertStringIncludes(out, `data-pid="${page.id}"`);

    // without the right to edit, the values are text only
    const guest = Number(await app.db.table("usr").insert({ username: "guest@example.test", active: 1 }));
    const read = String(await runAs(app, guest, "test", () => tree.html()));
    assertStringIncludes(read, "About <small>(5 characters, !)</small>");
    assert(!read.includes("data-pid="));
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await fs.remove(dir, { recursive: true });
  }
});
