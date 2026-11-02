import { test } from "node:test";
import { assertEquals } from "./deps.ts";
import { Hono } from "../deps.ts";
import { App } from "../lib/App.ts";
import { fs } from "../lib/fs.ts";
import { honoAdapter } from "../lib/hono.ts";
import { Output } from "../lib/util.ts";

test("honoAdapter: an app mounted under a prefix runs there as its root", async () => {
  const dir = await fs.tempDir({ prefix: "qino-hono-" }) + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  await app.init();
  try {
    app.on("route", ({ ctx }) => {
      throw new Output({ appUrl: ctx.req.appUrl, appPath: ctx.req.appPath, ip: ctx.req.clientIp });
    });
    const hono = new Hono();
    hono.route("/xyz", honoAdapter(app));
    hono.route("/abc", honoAdapter(app)); // the same app twice: nothing depends on the mount path
    hono.get("/other", (c) => c.text("hono"));

    const info = { remoteAddr: { hostname: "203.0.113.7" } };
    const get = (path: string) => hono.fetch(new Request("http://qino.test" + path), info);
    const seen = async (path: string) => (await get(path)).json();

    assertEquals(await seen("/xyz/page/sub"), { appUrl: "/xyz/", appPath: "page/sub", ip: "203.0.113.7" });
    assertEquals(await seen("/xyz/"), { appUrl: "/xyz/", appPath: "", ip: "203.0.113.7" });
    assertEquals(await seen("/abc/page"), { appUrl: "/abc/", appPath: "page", ip: "203.0.113.7" });

    assertEquals(await (await get("/other")).text(), "hono", "routes beside the mount stay hono's");
    const outside = await get("/page");
    await outside.body?.cancel();
    assertEquals(outside.status, 404, "the app answers only below its prefix");
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100)); // session writes run in the background
    await app.db.close();
    await fs.remove(dir, { recursive: true });
  }
});
