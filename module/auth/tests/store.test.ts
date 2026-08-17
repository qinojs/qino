import { assertEquals } from "@std/assert";
import { Db } from "@qino/qino";

import dbSchema from "../dbschema.json" with { type: "json" };
import { drop, store, stored } from "../mod.ts";

import type { App } from "@qino/qino";

async function app(): Promise<App> {
  const db = new Db("sqlite::memory:");
  await db.migrate(dbSchema);
  await db.loadTables();
  // deno-lint-ignore no-explicit-any
  return { db } as any;
}

Deno.test("stored: several rows of one type are one factor with several secrets", async () => {
  const a = await app();
  await store(a, 7, "backup_codes", { hash: "one" });
  await store(a, 7, "backup_codes", { hash: "two" });
  await store(a, 7, "totp", { secret: "S" }, "Phone");

  assertEquals((await stored(a, 7, "backup_codes")).length, 2);
  assertEquals((await stored(a, 7, "totp")).map((r) => r.label), ["Phone"]);
  assertEquals(await stored(a, 8, "totp"), []);
  await a.db.close();
});

Deno.test("drop: keyed by the user, so a foreign row is out of reach", async () => {
  const a = await app();
  await store(a, 7, "totp", { secret: "mine" });
  const [row] = await stored(a, 7, "totp");
  const id = Number(row.id);

  assertEquals(await drop(a, 8, "totp", id), 0, "another user's id removes nothing");
  assertEquals(await drop(a, 7, "webauthn", id), 0, "nor does the wrong type");
  assertEquals(await drop(a, 7, "totp", id), 1);
  assertEquals(await drop(a, 7, "totp", id), 0, "and once gone it is gone");
  await a.db.close();
});

Deno.test("drop: without an id it takes the whole kind, and only that kind", async () => {
  const a = await app();
  await store(a, 7, "backup_codes", { hash: "one" });
  await store(a, 7, "backup_codes", { hash: "two" });
  await store(a, 7, "totp", { secret: "S" });

  assertEquals(await drop(a, 7, "backup_codes"), 2);
  assertEquals((await stored(a, 7, "totp")).length, 1);
  await a.db.close();
});
