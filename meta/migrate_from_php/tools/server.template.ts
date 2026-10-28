/* Migration test: the __SITE__ project on qino.
   Runs against __DB___qino — a copy of the PHP database, so the PHP original keeps its own.
   Reset: see MIGRATION.md. The module lists come from the site's own page.module values,
   new-project.sh filled them in. */
import { App } from "@qino/qino";
import { migrate } from "../../qino/meta/migrate_from_php/mod.ts";

const base = import.meta.resolve("./");
const url = (path: string): string => new URL(path, base).href;

const app = new App({
  dir: import.meta.dirname,
  db: Deno.env.get("__ENV__") ?? "__DBURL__",
  dev: true,
});

const std = app.stores.add(url("../../qino/module/store.json")).add("cms");
// right after cms: renames the legacy modules and restores the texts before any other module installs
app.stores.add(url("../../qino/meta/store.json")).add("migrate_from_php"); // qg/ → data/, legacy settings + access levels
for (
  const mod of [
    "cms.text", "cms.image", "cms.cont.flexible", "cms.cont.text", "cms.cont.image",
    "cms.frontend", "cms.filebrowser", "fileEditor", // inline editing
    // the site's own modules, under the names they end up with after the migration
__STD__
  ]
) std.add(mod);

// old page.module names — listed one by one, addAll() would pull in modules of other stores too
const legacy = app.stores.add(url("../../qino/cms-legacy/store.json"));
for (
  const mod of [
    "cms.legacy.c1", // browser helpers the ported site templates load
__LEGACY__
  ]
) legacy.add(mod);

// the standard set every site starts from: it adds the pages it does not find under its names
// (home, contact, service/imprint …) — name the site's own ones first, or they come twice
std.add("starter.cms");

__MISSING__
await migrate(app); // before init: renamed columns, names for the system pages
await app.init();

const port = Number(Deno.env.get("PORT") ?? __PORT__);
console.log(`Qino __SHORT__ migration - http://localhost:${port}`);
Deno.serve({ port }, app.fetch);
