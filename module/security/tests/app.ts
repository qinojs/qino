import { App } from "@qino/qino";

import type { Ctx } from "@qino/qino";

/** A request from `ip`, as the second argument of app.fetch(). */
export const from = (ip: string) => ({ remoteAddr: { hostname: ip } });

/** A GET on `path` below the app from `ip`. */
export const get = (app: App, ip: string, path = "robots.txt") => app.fetch(new Request("https://qino.test/site/" + path), from(ip));

/** Waits for what runs in the background: score writes, report conditions. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

/** A minimal ctx for app.fire("suspicious"). */
export const ctxOf = (app: App, ip: string) => ({ app, req: { clientIp: ip } }) as unknown as Ctx;

/** An app with security (and seo) on an sqlite file in `dir`, so a second app can reopen it. */
export async function testApp(dir: string): Promise<App> {
  const app = new App({ db: `sqlite:${dir}db.sqlite`, dir, appUrl: "/site/" });
  app.stores.add(import.meta.resolve("../../store.json")).add("seo").add("security");
  await app.init();
  return app;
}

export async function close(app: App): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 100));
  await app.db.close();
}

/** Runs `fn` in a temp dir, removed afterwards. */
export async function inDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir() + "/";
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/** Runs `fn` with a fresh app, closed and removed afterwards. */
export const withApp = (fn: (app: App) => Promise<void>) => inDir(async (dir) => {
  const app = await testApp(dir);
  try {
    await fn(app);
  } finally {
    await close(app);
  }
});
