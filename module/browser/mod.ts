import { fs, sys } from "@qino/qino";

import { Playwright } from "./lib/playwright.ts";
import { proxy } from "./lib/proxy.ts";
import { Puppeteer } from "./lib/puppeteer.ts";

import type { App } from "@qino/qino";
import type { Page } from "./lib/Page.ts";

export type { Page };

/** Tried in this order when the setting names none. */
const CANDIDATES = ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome", "microsoft-edge"];
/** How long a browser without pages keeps running, for the next one. */
const KEEP = 30_000;

/** A command's path: as given if it has a slash, else the first in PATH. */
async function which(cmd: string) {
  if (cmd.includes("/")) return await fs.isFile(cmd) ? cmd : undefined;
  for (const dir of (sys.env("PATH") ?? "").split(":")) {
    if (dir && await fs.isFile(`${dir}/${cmd}`)) return `${dir}/${cmd}`;
  }
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

/** Tried in this order: the first that loads drives the browser. */
const DRIVERS = [Playwright, Puppeteer];

// Like the browser installed, which driver loads is a fact of the runtime, so it is looked up once.
let loaded: Promise<typeof DRIVERS[number]> | undefined;

/** The driver: the first that loads; if none, why. */
export function driver(): Promise<typeof DRIVERS[number]> {
  return loaded ??= (async () => {
    const missing = [];
    for (const one of DRIVERS) {
      const why = await one.missing();
      if (!why) return one;
      missing.push(why);
    }
    throw new Error(`browser: no driver loads — ${missing.join("; ")}`);
  })();
}

// One process per binary, shared by the apps of this runtime like the binary itself: each page has a
// context of its own, so they see nothing of each other.
type Run = {
  browser: Promise<Playwright | Puppeteer>;
  proxy?: ReturnType<typeof proxy>;
  pages: number;
  idle?: ReturnType<typeof setTimeout>;
};
const running = new Map<string, Run>();

function start(cmd: string) {
  const run: Run = { pages: 0, browser: driver().then((one): Run["browser"] => one.launch(cmd)) };
  running.set(cmd, run);
  const gone = () => {
    if (running.get(cmd) === run) running.delete(cmd);
    run.proxy?.then((p) => p.close()).catch(() => {});
  };
  run.browser.then((browser) => browser.on("disconnected", gone), gone);
  return run;
}

function release(cmd: string, run: Run) {
  if (--run.pages) return;
  run.idle = setTimeout(() => {
    if (running.get(cmd) === run) running.delete(cmd); // the next page starts a new one
    run.browser.then((browser) => browser.close()).catch(() => {});
  }, KEEP);
  sys.unrefTimer(run.idle);
}

/**
 * A new page in a context of its own (cookies, storage, cache), closed with the page. `guard` (default):
 * it only reaches public addresses, through a proxy that checks each; without, for pages of our own.
 */
export async function open(app: App, { guard = true }: { guard?: boolean } = {}): Promise<Page> {
  const cmd = await executable(app);
  if (!cmd) throw new Error("browser: no Chromium found — install one or set browser.executable");
  const run = running.get(cmd) ?? start(cmd);
  clearTimeout(run.idle);
  run.pages++;
  const page = await (async () => {
    const via = guard ? (await (run.proxy ??= proxy())).server : undefined;
    return (await run.browser).page({ proxy: via });
  })().catch((e) => {
    release(cmd, run);
    throw e;
  });
  page.on("close", () => release(cmd, run));
  return page;
}
