import { test } from "node:test";
import { App, Ctx, fs, requestStorage } from "@qino/qino";
import { cms as cmsOf } from "@qino/qino/cms";
import { assertEquals } from "@qino/qino/tests";

import { backendDashboardWidget, cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };

const { name, dependencies } = manifest;

test("cms.backend.struct: metadata and cms export are wired", () => {
  assertEquals(name, "cms.backend.cms.tree");
  assertEquals(dependencies, ["cms.backend"]);
  assertEquals(cms.node.css, ["pub/main.css"]);
  assertEquals(typeof cms.node.parts.list, "function");
});

test("cms.backend.struct: dashboard widget renders page counters", async () => {
  const values = [20, 3, 5];
  const app = { db: { one: () => values.shift() }, t: (s: TemplateStringsArray) => Promise.resolve(s.join("")) } as unknown as
    Parameters<typeof backendDashboardWidget>[0];
  const out = String(await backendDashboardWidget(app));
  assertEquals(out.includes("Pages total:<td>20"), true);
  assertEquals(out.includes("Offline:<td>3"), true);
  assertEquals(out.includes("Hidden:<td>5"), true);
});

test("cms.backend.cms.tree: the breadcrumb names no page the user may not read", async () => {
  const dir = await fs.tempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms").add("cms.backend.cms.tree");
  await app.init();
  try {
    const root = await cmsOf(app).node(1);
    const closed = await root.createChild({ access: 0, online_start: 0 });
    await closed.title(app.languages.def, "Secret");
    const open = await closed.createChild({ access: 1, online_start: 0 });
    await open.title(app.languages.def, "Shown");
    const ctx = await Ctx.create(app, new Request("http://qino.test/"), { appUrl: "/" });
    ctx.sess = await app.sessions.load();
    ctx.lang = app.languages.def;
    ctx.initSettings();
    const out = await requestStorage.run(ctx, async () => {
      ctx.settings.cms.admin.rootPageNode(open.id); // the settings are the user's to write
      return String(await cms.node.render(open, { ctx }));
    });
    assertEquals([out.includes("Secret"), out.includes("Shown"), out.includes("no access")], [false, true, true]);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await fs.remove(dir, { recursive: true });
  }
});
