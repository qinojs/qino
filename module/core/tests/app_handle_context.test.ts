import { test } from "node:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { createServer } from "node:net";
import { pathToFileURL } from "node:url";
import { assertEquals } from "./deps.ts";
import { Hono } from "../deps.ts";
import { App } from "../lib/App.ts";
import { fs } from "../lib/fs.ts";
import { honoAdapter } from "../lib/hono.ts";
import { sys } from "../lib/sys.ts";

const freePort = () => new Promise<number>((resolve) => {
  const probe = createServer().listen(0, "127.0.0.1", () => {
    const { port } = probe.address() as { port: number };
    probe.close(() => resolve(port));
  });
});

type Fetch = (req: Request, info: { remoteAddr: { hostname: string } }) => Response | Promise<Response>;

/** A module first loaded during a request must not leak that request's context into later ones.
 *  Uses a real server: the leak only shows in how the runtime calls the handler. */
function leakTest(name: string, path: string, mount: (app: App) => Fetch) {
  test(`App.handle: no context leaks in from an earlier request (${name})`, async () => {
    const dir = await fs.tempDir({ prefix: "qino-handle-" }) + "/";
    const app = new App({ db: "sqlite::memory:", dir });
    await app.init();
    const stop = new AbortController();
    try {
      await fs.write(dir + "lazy.mjs", "export default 1;");
      const als = new AsyncLocalStorage<string>();
      let seen: string | undefined = "not reached";
      app.on("response-ready", () => { seen = als.getStore(); });
      const mounted = mount(app);
      const port = await freePort();
      sys.serve({ port, hostname: "127.0.0.1", signal: stop.signal }, async (req, info) => {
        if (new URL(req.url).pathname !== "/import") return mounted(req, info);
        await als.run("earlier request", () => import(pathToFileURL(dir + "lazy.mjs").href));
        return new Response("loaded");
      });
      // node:http binds asynchronously
      const get = async (url: string, tries = 50): Promise<string> => {
        try { return await (await fetch(`http://127.0.0.1:${port}${url}`)).text(); } catch (e) {
          if (!tries) throw e;
          await new Promise((resolve) => setTimeout(resolve, 20));
          return get(url, tries - 1);
        }
      };
      assertEquals(await get("/import"), "loaded");
      await get(path);
      assertEquals(seen, undefined);
    } finally {
      stop.abort();
      await app.db.close();
      await fs.remove(dir, { recursive: true });
    }
  });
}

leakTest("app.fetch", "/m/none/pub/x.js", (app) => app.fetch);
leakTest("mounted with hono", "/pg/m/none/pub/x.js", (app) => {
  const hono = new Hono();
  hono.route("/pg", honoAdapter(app));
  return hono.fetch as Fetch;
});

test("App.handle: only Deno drops the context around a request", async () => {
  const dir = await fs.tempDir({ prefix: "qino-handle-" }) + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  await app.init();
  try {
    const als = new AsyncLocalStorage<string>();
    let seen: string | undefined = "not reached";
    app.on("response-ready", () => { seen = als.getStore(); });
    await als.run("caller", () => app.handle(new Request("http://qino.test/m/none/pub/x.js")));
    assertEquals(seen, "Deno" in globalThis ? undefined : "caller");
  } finally {
    await app.db.close();
    await fs.remove(dir, { recursive: true });
  }
});
