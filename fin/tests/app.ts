// A real app for the fin tests: translations, identity, the document and the backend need one.
import { App, requestStorage } from "@qino/qino";
import { testContext } from "@qino/qino/tests";

import type { Node } from "@qino/qino/cms";

/** What every fin app links from the module store. */
const BASE = ["cron", "identity", "locale.country", "locale.currency", "pdf"];

/** Boot an app with the base module fin and these (fin's, or others by name), run `fn`, tear it down again. */
export async function withFinApp(fin: string[], fn: (app: App) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "qino-fin-test-" });
  const app = new App({ dir, db: "sqlite::memory:" });
  for (const name of BASE) app.modules.add(new URL(`../../module/${name}/plugin.ts`, import.meta.url));
  // fin's own modules from this store, any other (messaging.email …) from the module store
  const store = (name: string) => /^(fin|cms\.backend\.superuser\.fin)(\.|$)/.test(name) ? "../" : "../../module/";
  for (const name of ["fin", ...fin]) app.modules.add(new URL(`${store(name)}${name}/plugin.ts`, import.meta.url));
  try {
    await app.init();
    await app.settings.core.url("https://shop.test/");
    // the sender of invoices and the creditor of QR bills
    const org = app.settings.identity.organization;
    await org.name("Atelier Muster");
    await org.vatID("CHE-123.456.789 MWST");
    await org.address.streetAddress("Hauptgasse 1");
    await org.address.postalCode("3280");
    await org.address.addressLocality("Murten");
    await org.address.addressCountry("CH");
    await fn(app);
  } finally {
    // the other way round than linked, so nothing goes before what needs it; this stops the job timers
    for (const mod of app.modules.linked().toReversed()) if (mod.name !== "core") app.modules.unlink(mod.name);
    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  }
}

/** Run `fn` inside a request to `url`, as the app itself. What it renders must not hold a promise
 *  that was never awaited — the trap of a t`` inside a plain html``. */
export async function inRequest<T>(app: App, url: string, fn: () => Promise<T>): Promise<T> {
  // a session that can sign links to private files (receipts, PDFs)
  let grantKey = "";
  const core = {
    userId: () => 0,
    pending: () => undefined,
    grantKey: (v?: string) => v === undefined ? grantKey : (grantKey = v),
  };
  const out = await requestStorage.run(await testContext({ url, app, set: { app }, sess: { data: { core } } }), fn);
  if (String(out).includes("[object Promise]")) throw new Error(`${url} rendered a promise`);
  return out;
}

/** A backend node at `url`, without a CMS around it: links to other backend pages become text. */
export const backendNode = (app: App, url: string): Node => ({
  app,
  page: () => Promise.resolve({ url: () => Promise.resolve(url), children: () => Promise.resolve(new Map()) }),
  cms: { nodeByModule: () => Promise.resolve(undefined) },
}) as unknown as Node;
