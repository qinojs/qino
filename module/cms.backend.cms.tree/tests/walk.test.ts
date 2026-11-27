import { test } from "node:test";
import { App, Ctx, fs, html, requestStorage } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { assertEquals, assertStringIncludes } from "@qino/qino/tests";

import { walk } from "../mod.ts";

test("cms.backend.cms.tree: walk lists open pages with their children, as the user's settings say", async () => {
  const dir = await fs.tempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms").add("cms.backend.cms.tree");
  await app.init();
  try {
    const root = await (await cms(app).node(1)).createChild({ access: 1, online_start: 0 });
    const a = await root.createChild({ access: 1, online_start: 0 });
    const b = await a.createChild({ access: 1, online_start: 0 });
    const closed = await root.createChild({ access: 0, online_start: 0 });
    await a.createCont({ module: "cms.cont.text" });
    const ctx = await Ctx.create(app, new Request("http://qino.test/"), { appUrl: "/" });
    ctx.sess = await app.sessions.load();
    ctx.lang = app.languages.def;
    ctx.initSettings();
    ctx.settings.cms.admin.rootPageNode(root.id); // the tree starts there
    const ids = (vars: Record<string, unknown> = {}, opt = {}) => requestStorage.run(ctx, async () => {
      const out = String(await walk(root, { ctx, vars }, ({ page, level }) => html.async`[${page.id}:${level}]`, opt));
      return [...out.matchAll(/\[(\d+):(\d+)\]/g)].map((m) => `${m[1]}:${m[2]}`);
    });

    assertEquals(await ids(), [`${a.id}:0`, `${closed.id}:0`]); // closed by default
    assertEquals(await ids({ toggleOpen: a.id, value: "1" }), [`${a.id}:0`, `${b.id}:1`, `${closed.id}:0`]);
    assertEquals(await ids(), [`${a.id}:0`, `${b.id}:1`, `${closed.id}:0`], "kept in the settings");
    assertEquals((await ids({ showContents: "1" })).length, 4, "the content shows too");
    assertEquals((await ids({}, { type: "p" })).length, 3, "unless the tree is of pages only");
    assertEquals(await ids({ showContents: "0" }, { readable: true }), [`${a.id}:0`, `${b.id}:1`]);
    assertEquals(await ids({ toggleOpen: a.id, value: "0" }), [`${a.id}:0`, `${closed.id}:0`]);

    // the lead: the number makes it the start, the open page has its close button
    const lead = await requestStorage.run(ctx, async () =>
      String(await walk(root, { ctx }, ({ page, lead }) => page.id === a.id ? lead("A") : html``)));
    assertStringIncludes(lead, `rp=${a.id}`);
    assertStringIncludes(lead, `data-toggle-id="${a.id}" data-toggle-value="1"`);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await fs.remove(dir, { recursive: true });
  }
});
