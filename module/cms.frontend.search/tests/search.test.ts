import { App, getCtx, runAs } from "@qino/qino";
import { cms, cmsCtx } from "@qino/qino/cms";
import { invalidateStandards } from "@qino/qino/cms.accessRules";
import { apiRequest, assert, assertEquals } from "@qino/qino/tests";

import type { search } from "../search.ts";

Deno.test("cms.frontend.search: administration search respects node, file, user and module permissions", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms.frontend.search").add("cms.cont.text")
    .add("cms.backend.users").add("cms.accessRules");
  await app.init();
  try {
    await app.settings.core.url("https://qino.test/");
    await app.settings.cms.frontend("cms.frontend");
    const db = app.db;
    const admin = Number(await db.table("usr").insert({ active: true, given_name: "Ada", username: "ada", superuser: false }));
    const outsider = Number(await db.table("usr").insert({ active: true, given_name: "Lemon", username: "outsider", superuser: false }));
    const su = Number(await db.table("usr").insert({ active: true, given_name: "Lemon", username: "root", superuser: true }));
    const root = await cms(app).node(1);
    const future = Math.floor(Date.now() / 1000) + 3600;
    const page = await root.createChild({ access: 0, online_start: future, visible: false, searchable: false });
    await page.title("en", "Lemon archive");
    await page.changeUser(admin, 2);
    await page.urlSet("en", { url: "citrus-archive", custom: true });
    const section = await page.createCont({ visible: false });
    await section.title("en", "Recipes");
    const text = await section.createCont({ module: "cms.cont.text", visible: false });
    await text.title("en", "Hidden recipe");
    await text.text("main", "en", "<p>Lemon tart</p>");
    const secret = await root.createChild({ access: 0, online_start: null });
    await secret.title("en", "Secret lemon");
    const privateText = await secret.createCont({ module: "cms.cont.text" });
    await privateText.text("main", "en", "Lemon secret");
    const readableChild = await secret.createCont({ module: "cms.cont.text", online_start: 0 });
    await readableChild.title("en", "Lemon on a private page");
    await readableChild.changeUser(admin, 1);
    const futurePage = await root.createChild({ access: 1, online_start: future });
    await futurePage.title("en", "Lemon tomorrow");
    const readOnly = await root.createChild({ access: 1, online_start: 0 });
    await readOnly.title("en", "Public lemon");
    const readOnlyCont = await readOnly.createCont({ visible: true });
    await readOnlyCont.text("main", "en", "Read access marker");
    const userNode = (await cms(app).nodeByModule("cms.backend.users"))!;
    const userPage = await userNode.page();
    const file = await app.dbFiles.add(new File(["Lemon document"], "lemon.txt", { type: "text/plain" }));
    await file.setVs({ text: "Lemon document", access: false });
    await db.table("page_file").insert({ page_id: text.id, name: "document", file_id: file.id });
    await db.table("page_file").insert({ page_id: section.id, name: "document", file_id: file.id });
    await db.table("page_file").insert({ page_id: privateText.id, name: "shared", file_id: file.id });
    await db.table("page_file").insert({ page_id: readOnly.id, name: "document", file_id: file.id });
    const privateFile = await app.dbFiles.add(new File(["Secret document"], "lemon-private.txt", { type: "text/plain" }));
    await privateFile.setVs({ access: false });
    await db.table("page_file").insert({ page_id: privateText.id, name: "document", file_id: privateFile.id });
    const image = await app.dbFiles.add(new File([Uint8Array.fromBase64("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/dsAAAAASUVORK5CYII=")], "lemon.png", { type: "image/png" }));
    await image.setVs({ access: false });
    await db.table("page_file").insert({ page_id: text.id, name: "image", file_id: image.id });
    await db.table("usr_contact").insert({ usr_id: outsider, type: "email", address: "contact@example.test" });

    const request = (query: string, pid = page.id) => apiRequest(app.apiTree,
      `/cms.frontend.search/search?pid=${pid}&search=${encodeURIComponent(query)}`);
    const find = (query: string, user = admin) => runAs(app, user, "search-test", async () => {
      const response = await request(query);
      assertEquals(response.status, 200, await response.clone().text());
      return await response.json() as Awaited<ReturnType<typeof search>>;
    });
    const found = await find("lemon");
    assertEquals(found.pages.map((r) => r.id), [page.id, readOnly.id]);
    assert(!found.pages.find((r) => r.id === readOnly.id)!.url.includes("cms_editmode=1"));
    assertEquals((await find("access marker")).contents.map((r) => r.id), [readOnlyCont.id]);
    assertEquals(found.contents.map((r) => r.id), [text.id]);
    assertEquals(found.files.map((r) => r.id).sort((a, b) => a - b), [file.id, image.id]);
    assertEquals(found.pages[0].breadcrumb.map((p) => p.id), [root.id]);
    assertEquals(found.contents[0].breadcrumb.map((p) => p.title), ["root", "Lemon archive", "Recipes"]);
    const preview = found.files.find((r) => r.id === image.id)!.thumb;
    assert(preview?.includes("w-96/h-72/max") && preview.includes("sig="));
    assertEquals(found.files.find((r) => r.id === file.id)!.thumb, undefined);
    assertEquals(found.files.find((r) => r.id === file.id)!.pages.map((p) => p.id), [page.id, readOnly.id], "Usage is deduplicated per readable page and respects access.");
    assertEquals(found.contents[0].snippet, "Lemon tart");
    assertEquals(found.users, [], "A CMS editor without access to the user administration sees no users.");
    assert(found.contents[0].url.includes("cms_editmode=1") && found.contents[0].url.includes("#"));
    assert(found.files[0].url.includes("sig="), "Private file links carry the session grant.");
    assertEquals((await find("cont.text")).contents.map((r) => r.id), [text.id]);
    assertEquals((await find("cont.text lemon")).contents.map((r) => r.id), [text.id]);
    assertEquals((await find(String(text.id))).contents.map((r) => r.id), [text.id]);
    assertEquals((await find("citrus-archive")).pages.map((r) => r.id), [page.id]);
    assertEquals(await find("   "), { pages: [], contents: [], files: [], users: [], limit: 20 });
    assertEquals((await runAs(app, outsider, "search-test", () => request("lemon"))).status, 403);
    assertEquals((await runAs(app, admin, "search-test", () => request("lemon", secret.id))).status, 403);

    await userPage.changeUser(admin, 1);
    assertEquals((await find("lemon")).users.map((r) => r.id), [outsider]);
    const contacts = await find("contact@example.test");
    assertEquals(contacts.users.map((r) => r.id), [outsider]);
    assert(new URL(contacts.users[0].url, "https://qino.test").searchParams.get("id") === String(outsider));
    assert((await find("lemon", su)).users.some((r) => r.id === su));

    const bodyHit = await page.createCont({ module: "cms.cont.text" });
    await bodyHit.title("en", "Body match");
    await bodyHit.text("main", "en", `<p>${"Before ".repeat(40)}needle &amp; thread ${"after ".repeat(40)}</p>`);
    const partialHit = await page.createCont({ module: "cms.cont.text" });
    await partialHit.title("en", "Needle collection");
    const exactHit = await page.createCont({ module: "cms.cont.text" });
    await exactHit.title("en", "Needle");
    const ranked = await find("NEEDLE");
    assertEquals(ranked.contents.map((r) => r.id), [exactHit.id, partialHit.id, bodyHit.id]);
    const excerpt = ranked.contents.find((r) => r.id === bodyHit.id)!.snippet;
    assert(excerpt.includes("needle & thread") && excerpt.startsWith("…") && excerpt.endsWith("…") && excerpt.length <= 182, excerpt);
    assertEquals((await find("cont.text needle")).contents[0].id, partialHit.id, "Title matches also rank before body matches in combined module queries.");
    for (let i = 0; i < 21; i++) {
      const node = await page.createCont({ module: "cms.cont.text" });
      await node.title("en", `Limited ${i}`);
    }
    const limited = await find("limited");
    assertEquals(limited.contents.length, limited.limit);

    // The feature contributes its own script; the existing panel is unchanged.
    await runAs(app, admin, "search-test", async () => {
      const ctx = getCtx();
      cmsCtx(ctx).mainNode = page;
      cmsCtx(ctx).editmode = 1;
      await cms(app).fire("page:render-after", { ctx });
      assert(ctx.res.html.scripts.has(ctx.req.moduleUrl + "cms.frontend.search/pub/init.js"));
    });
    await db.table("module").update("cms.frontend.search", { cms_access: 0 });
    invalidateStandards(app);
    assertEquals((await runAs(app, admin, "search-test", () => request("lemon"))).status, 403);
  } finally {
    for (const mod of app.modules.linked().toReversed()) if (mod.name !== "core") app.modules.unlink(mod.name);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  }
});
