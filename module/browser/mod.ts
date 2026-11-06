import { Buffer } from "node:buffer";

import { fs, safeFetch, sys } from "@qino/qino";

import type { App } from "@qino/qino";
import type { Browser, BrowserContext, Page, Route } from "playwright-core";

/** Tried in this order when the setting names none. */
const CANDIDATES = ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome", "microsoft-edge"];
/** How long a browser without pages keeps running, for the next one. */
const KEEP = 30_000;

/** A command's path: as given if it has a slash, else the first in PATH. */
async function which(cmd: string) {
  if (cmd.includes("/")) return await fs.isFile(cmd) ? cmd : undefined;
  for (const dir of (sys.env("PATH") ?? "").split(":")) if (dir && await fs.isFile(`${dir}/${cmd}`)) return `${dir}/${cmd}`;
}

// Which browser is installed is a fact of the machine, not of an app, so it is looked up once.
let found: Promise<string | undefined> | undefined;

/** The browser's path: the setting (a name or a path), else the first one installed. */
export async function executable(app: App): Promise<string | undefined> {
  const set = String(await app.settings.browser.executable ?? "");
  if (set) return await which(set) ?? set; // not found: its launch says so
  return found ??= (async () => {
    for (const cmd of CANDIDATES) {
      const path = await which(cmd);
      if (path) return path;
    }
  })();
}

// One process per binary, shared by the apps of this runtime like the binary itself: each page has a
// context of its own (cookies, storage, cache), so they see nothing of each other.
type Run = { browser: Promise<Browser>; pages: number; idle?: ReturnType<typeof setTimeout> };
const running = new Map<string, Run>();

function start(cmd: string) {
  const run: Run = { pages: 0, browser: launch(cmd) };
  running.set(cmd, run);
  const gone = () => running.get(cmd) === run && running.delete(cmd);
  run.browser.then((b) => b.on("disconnected", gone), gone);
  return run;
}

async function launch(cmd: string) {
  const { chromium } = await import("playwright-core").catch(() => {
    throw new Error("browser: playwright-core is not installed (npm install playwright-core)");
  });
  return chromium.launch({ executablePath: cmd });
}

function release(cmd: string, run: Run) {
  if (--run.pages) return;
  run.idle = setTimeout(() => {
    if (running.get(cmd) === run) running.delete(cmd);
    run.browser.then((b) => b.close()).catch(() => {});
  }, KEEP);
  sys.unrefTimer(run.idle);
}

/**
 * A new page in a context of its own, closed with the page. `guard` (default): it only reaches
 * public addresses, every request goes through `safeFetch`; without, for pages of our own.
 */
export async function open(app: App, { guard = true }: { guard?: boolean } = {}): Promise<Page> {
  const cmd = await executable(app);
  if (!cmd) throw new Error("browser: no Chromium found — install one or set browser.executable");
  const run = running.get(cmd) ?? start(cmd);
  clearTimeout(run.idle);
  run.pages++;
  const context = await run.browser
    .then((b) => b.newContext({ serviceWorkers: "block", acceptDownloads: false }))
    .catch((e) => {
      release(cmd, run);
      throw e;
    });
  context.on("close", () => release(cmd, run));
  if (guard) await guarded(context);
  const page = await context.newPage();
  page.on("close", () => void context.close().catch(() => {}));
  return page;
}

/** Every request of the context through `safeFetch`; redirects go back to the browser, which asks again. */
async function guarded(context: BrowserContext) {
  await context.routeWebSocket(/.*/, (ws) => ws.close()); // not checked, so not opened
  // blocked or failed: the browser sees a request it was not allowed (the page may be gone, too)
  await context.route(/.*/, (route) => relay(route).catch(() => route.abort("blockedbyclient").catch(() => {})));
}

async function relay(route: Route) {
  const req = route.request();
  // the body comes back as served: no compression the browser would expect to undo
  const headers = Object.fromEntries(
    Object.entries(await req.allHeaders()).filter(([name]) => !/^(:|accept-encoding$)/.test(name)),
  );
  const data = req.postDataBuffer();
  const res = await safeFetch(req.url(), { method: req.method(), headers, body: data && new Uint8Array(data), redirect: "manual" });
  const out = Object.fromEntries([...res.headers].filter(([name]) => !/^(content-length|content-encoding)$/.test(name)));
  const cookies = res.headers.getSetCookie();
  if (cookies.length) out["set-cookie"] = cookies.join("\n");
  await route.fulfill({ status: res.status, headers: out, body: Buffer.from(await res.arrayBuffer()) });
}
