import { test } from "node:test";
import { App, Ctx, fs, requestStorage } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { assertEquals } from "@qino/qino/tests";

import { cms as errors } from "../plugin.ts";

async function setup(url = "http://qino.test/") {
  const dir = await fs.tempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms").add("cms.backend.superuser.error_report");
  await app.init();
  const node = await (await cms(app).node(1)).createCont({ module: "cms.backend.superuser.error_report" });
  const make = async (url: string) => {
    const ctx = await Ctx.create(app, new Request(url), { appUrl: "/" });
    ctx.sess = await app.sessions.load();
    ctx.lang = app.languages.def;
    await ctx.initSettings();
    return ctx;
  };
  let ctx = await make(url);
  const setUrl = async (to: string) => { ctx = await make(to); };
  const run = (vars: Record<string, unknown> = {}) =>
    requestStorage.run(ctx, async () => String(await errors.node.render(node, { ctx, vars })));
  const close = async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await fs.remove(dir, { recursive: true });
  };
  return { app, run, close, setUrl };
}

test("error_report: a group without file or source is deleted by its button", async () => {
  const { app, run, close } = await setup();
  try {
    await app.db.table("m_error_report").insert({ message: "boom", time: "2026-11-26 10:00:00", prio: "error" });
    const out = await run();
    // what the button sends: its data attributes
    const group = Object.fromEntries([...out.matchAll(/data-(source|file|line|col)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
    assertEquals(group.file, "null");
    await run({ deleteGroup: group });
    assertEquals(Number(await app.db.one`SELECT count(*) FROM m_error_report`), 0);
  } finally {
    await close();
  }
});

test("error_report: an error without log entry still shows the history of its ip", async () => {
  const { app, run, close, setUrl } = await setup();
  try {
    const ip = Number(await app.db.table("log_ip").insert({ ip: "203.0.113.7" }));
    const url = Number(await app.db.table("log_url").insert({ url: "https://qino.test/visited" }));
    await app.db.table("log").insert({ ip_id: ip, url_id: url, time: 1_795_000_000 });
    const id = Number(await app.db.table("m_error_report").insert({ message: "boom", ip: "203.0.113.7", time: "2026-11-26 10:00:00" }));
    await setUrl(`http://qino.test/?id=${id}`);
    assertEquals((await run()).includes("https://qino.test/visited"), true);
  } finally {
    await close();
  }
});
