import { requestStorage, sql } from "@qino/qino";
import { assertEquals, assertRejects, fakeCms } from "@qino/qino/tests";

import { tableEntriesCopyTo } from "../lib/Spaces.ts";
import { copyNode } from "../lib/CmsVers.ts";
import { getVers, setVers, versedTables } from "../lib/Vers.ts";

Deno.test("cms.versions: failed copy restores request version state", async () => {
  const ctx = { state: {}, app: {} as { db?: unknown } };
  const table = {
    valuesToFragment: () => sql``,
    entryId: ({ id }: { id: number }) => String(id),
    ensure() {
      assertEquals(getVers(ctx as never), { space: 0, log: 0, tableEntriesCopying: true });
      throw new Error("write failed");
    },
  };
  let reads = 0;
  const db = {
    table: () => table,
    query: () => ++reads === 1 ? [] : [{ id: 1 }],
  };
  ctx.app.db = db;
  versedTables(db as never).page = true;
  setVers(ctx as never, [7, 8]);

  await requestStorage.run(ctx as never, () =>
    assertRejects(() => tableEntriesCopyTo(db as never, "page", { id: 1 }, 0, 0, 0), Error, "write failed")
  );

  assertEquals(getVers(ctx as never), { space: 7, log: 8, tableEntriesCopying: false });
});

Deno.test("cms.versions: failed node copy restores state and caches", async () => {
  let cmsClears = 0;
  let textClears = 0;
  let fileClears = 0;
  const db = {};
  const app = {
    db,
    dbTexts: { clearCache: () => textClears++ },
    dbFiles: { clearCache: () => fileClears++ },
    languages: { all: [] },
  };
  const ctx = { state: {}, app };
  setVers(ctx as never, [7, 8]);
  fakeCms(app, {
    clearCache: () => cmsClears++,
    node() {
      assertEquals(getVers(ctx as never), { space: 2, log: 3, tableEntriesCopying: false });
      throw new Error("load failed");
    },
  });

  await requestStorage.run(ctx as never, () =>
    assertRejects(() => copyNode(db as never, 1, 2, 3, 0), Error, "load failed")
  );

  assertEquals(getVers(ctx as never), { space: 7, log: 8, tableEntriesCopying: false });
  assertEquals([cmsClears, textClears, fileClears], [2, 1, 1]);
});
