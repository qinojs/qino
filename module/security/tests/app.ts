import { App } from "@qino/qino";

import type { Ctx } from "@qino/qino";

/** A request coming from `ip`, as the second argument of app.fetch(). */
export const from = (ip: string) => ({ remoteAddr: { hostname: ip } });

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
