// deno-lint-ignore-file no-explicit-any
import { assertEquals, assertRejects } from "@std/assert";
import { App } from "@qino/qino";
import { historicalViews, versedTables } from "../lib/Vers.ts";

async function versionedApp() {
  const app = new App({ db: "sqlite::memory:", dir: await Deno.makeTempDir() + "/" });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms").add("cms.versions");
  await app.init();
  return app;
}

// Historical views are one-shot: one set per browsed log entry would pile up in the database,
// where nothing collects them again — not a restart, not the GC.
const views = (app: App) =>
  app.db.col<string>`SELECT name FROM sqlite_master WHERE type = 'view' AND name LIKE '_vers_5%'`;

Deno.test("historicalViews: routes reads while open, drops every view on dispose", async () => {
  await using app = await versionedApp();
  const ctx = { app, state: {} as any } as any;

  {
    await using _v = await historicalViews(ctx, 0, 5);
    assertEquals((await views(app)).length, 6);
    assertEquals(!!ctx.state.dbScope.tables, true);
  }

  assertEquals(await views(app), []);
  assertEquals(ctx.state.dbScope.tables, undefined); // routing stopped, request cache stays
});

Deno.test("historicalViews: a failed render leaves no view behind", async () => {
  await using app = await versionedApp();
  const ctx = { app, state: {} as any } as any;

  const failed = await (async () => {
    await using _v = await historicalViews(ctx, 0, 5);
    throw new Error("render failed");
  })().then(() => "", (e) => e.message);

  assertEquals(failed, "render failed");
  assertEquals(await views(app), []);
});

Deno.test("historicalViews: a half-built set is dropped when setup itself fails", async () => {
  const queries: unknown[] = [];
  let columns = 0;
  const db = {
    on() {},
    query(...args: unknown[]) { queries.push(args); },
    columns() {
      if (++columns > 1) throw new Error("setup failed");
      return [{ Field: "id", Key: "PRI" }];
    },
  };
  Object.assign(versedTables(db as never), { page: true, page_text: true });
  const ctx = { app: { db }, state: {} as any } as any;

  await assertRejects(() => historicalViews(ctx, 0, 2), Error, "setup failed");

  assertEquals(queries.length, 3); // create first view (2 queries), then drop it
});
