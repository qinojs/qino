/* Migration test: the __SITE__ project on qino.
   Runs against __DB___qino — a copy of the PHP database, so the PHP original keeps its own.
   Reset: see MIGRATION.md. The module lists come from the site's own page.module values,
   new-project.sh filled them in. */
import { App } from "@qino/qino";

const base = import.meta.resolve("./");
const url = (path: string): string => new URL(path, base).href;

const app = new App({
  dir: import.meta.dirname,
  db: Deno.env.get("__ENV__") ?? "__DBURL__",
  https: false,
  dev: true,
});

const std = app.stores.add(url("../../qino/module/store.json")).add("cms");
for (
  const mod of [
    "cms.text", "cms.image2", "cms.cont.flexible", "cms.cont.text", "cms.cont.image2",
    "cms.frontend.2", "cms.filebrowser", "fileEditor", // inline editing
    // the site's own modules, under the names they end up with after the migration
__STD__
  ]
) std.add(mod);

app.stores.add(url("../../qino/meta/store.json")).add("migrate_from_php"); // qg/ → data/, legacy settings + access levels

// old page.module names — listed one by one, addAll() would pull in modules of other stores too
const legacy = app.stores.add(url("../../qino/cms-legacy/store.json"));
for (
  const mod of [
    "cms.legacy.c1", // browser helpers the ported site templates load
__LEGACY__
  ]
) legacy.add(mod);

__MISSING__
await app.init();

const port = Number(Deno.env.get("PORT") ?? __PORT__);
console.log(`Qino __SHORT__ migration - http://localhost:${port}`);
Deno.serve({ port }, app.fetch);
