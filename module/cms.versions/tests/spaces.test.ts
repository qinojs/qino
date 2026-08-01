import { assertEquals, assertRejects } from "../../core/tests/deps.ts";
import { requestStorage, sql } from "../../core/mod.ts";
import { tableEntriesCopyTo } from "../lib/Spaces.ts";
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
