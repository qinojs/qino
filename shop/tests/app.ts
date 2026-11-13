// A real app for the shop tests: cms, fin and the shop modules named.
import { App, Ctx, fs, requestStorage } from "@qino/qino";

const BASE = ["cms", "browser", "cron", "identity", "locale.country", "locale.currency", "pdf", "score", "security", "seo", "user.profile"];
const FIN = ["fin", "fin.payment", "fin.invoice"];

/** Boot an app with the shop core and these shop modules, a product page 10 (CHF 24.50), run `fn`. */
export async function withShop(mods: string[], fn: (app: App) => Promise<void>): Promise<void> {
  const dir = await fs.tempDir({ prefix: "qino-shop-test-" });
  const app = new App({ dir, db: "sqlite::memory:" });
  for (const name of BASE) app.modules.add(new URL(`../../module/${name}/plugin.ts`, import.meta.url));
  for (const name of FIN) app.modules.add(new URL(`../../fin/${name}/plugin.ts`, import.meta.url));
  for (const name of ["cms.shop", ...mods]) app.modules.add(new URL(`../${name}/plugin.ts`, import.meta.url));
  try {
    await app.init();
    await app.db.exec`UPDATE country SET shop_tax_rate = ${8.1} WHERE id IN ('CH', 'LI')`;
    await app.db.exec`UPDATE country SET shop_tax_rate = ${19}, currency = ${"EUR"} WHERE id = ${"DE"}`;
    await app.settings["cms.shop"].country("CH");
    await app.db.table("page").insert({ id: 10, name: "Cup", access: 1 });
    await app.db.table("shop_product").insert({ id: 10, price: 2450, weight: 500 });
    await fn(app);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 10)); // the session writes after a tick
    await app.db.flush();
    for (const mod of app.modules.linked().toReversed()) if (mod.name !== "core") app.modules.unlink(mod.name);
    await app.db.close();
    await fs.remove(dir, { recursive: true });
  }
}

/** Run `fn` as a visitor with a session of its own. */
export async function asVisitor<T>(app: App, fn: (ctx: Ctx) => Promise<T>, ctx?: Ctx): Promise<T> {
  ctx ??= await Ctx.create(app, new Request("http://shop.test/"), { appUrl: "/" });
  ctx.sess ??= await app.sessions.load();
  return requestStorage.run(ctx, () => fn(ctx!));
}
