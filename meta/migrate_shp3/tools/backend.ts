/* Every backend page of the shop rendered once, one change through a page's api: what fails shows up
   here. run from a site's folder (its server.ts): deno run -A ../../qinojs/qino/meta/migrate_shp3/tools/backend.ts */
import { Ctx, requestStorage, runAs } from "@qino/qino";
import { cms } from "@qino/qino/cms";

import type { App } from "@qino/qino";

const { app } = await import(`file://${Deno.cwd()}/server.ts`) as { app: App };

const ctx = await Ctx.create(app, new Request("http://shop.test/"), { appUrl: "/" });
ctx.sess = await app.sessions.load();
await app.settings.core.url("http://shop.test/");
const admin = Number(await app.db.one`SELECT id FROM usr WHERE superuser = 1 LIMIT 1`);
await requestStorage.run(ctx, () => runAs(app, admin, "test", async () => {
  const pages = await app.db.query`SELECT id, module FROM page WHERE module LIKE 'cms.backend.sho%' OR module LIKE 'cms.backend.shp3%' ORDER BY module`;
  const product = String(await app.db.one`SELECT id FROM shop_product ORDER BY id DESC LIMIT 1`);
  for (const page of pages) {
    const node = await cms(app).node(Number(page.id));
    const show = async (vars: Record<string, unknown>) => {
      const out = String(await node.html(vars)).replace(/\s+/g, " ");
      console.log(`${page.id} ${page.module} ${JSON.stringify(vars)}: ${out.length} chars${out.includes("[object") ? " OBJECT" : ""} — ${out.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 200)}`);
    };
    await show({});
    if (page.module === "cms.backend.shop.products") await show({ product });
    if (page.module === "cms.backend.shop.orders") await show({ order: String(await app.db.one`SELECT id FROM shop_order WHERE status = 'paid' LIMIT 1`) });
  }
}));
Deno.exit(0);
