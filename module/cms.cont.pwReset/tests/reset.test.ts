import { assertEquals, assertNotEquals } from "@std/assert";
import { Db, pwVerify } from "@qino/qino";
import { fakeT, ticketDbSchema as ticketSchema } from "@qino/qino/tests";
import type { Node } from "@qino/qino/cms";
import { issue } from "@qino/qino/ticket";
import * as plugin from "../plugin.ts";
import api, { PURPOSE } from "../nodeApi.ts";

async function app() {
  const db = new Db("sqlite::memory:");
  await db.migrate(ticketSchema);
  await db.exec`CREATE TABLE usr (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, pw TEXT, active INTEGER)`;
  await db.exec`CREATE TABLE sess (id INTEGER PRIMARY KEY AUTOINCREMENT, usr_id INTEGER)`;
  await db.loadTables();
  await db.table("usr").insert({ email: "one@qino.test", pw: "old", active: 1 });
  await db.table("sess").insert({ usr_id: 1 });
  return {
    db,
    t: fakeT,
    modules: { all: () => ({ pwReset: { name: "pwReset", plugin } }), linked: () => true },
    // deno-lint-ignore no-explicit-any
  } as any;
}

Deno.test("the link sets the password once and logs every session out", async () => {
  const a = await app();
  const node = { app: a } as unknown as Node;
  const handle = await issue(a, PURPOSE, { usrId: 1 });

  assertEquals(await api(node, { reset: { handle, pw: "short" } }), {
    ok: false,
    message: "The password is too short.",
  });
  assertEquals(await api(node, { reset: { handle: "nonsense", pw: "a good password" } }), {
    ok: false,
    message: "This link is no longer valid. Please request a new one.",
  });
  assertEquals(await a.db.one`SELECT pw FROM usr WHERE id = ${1}`, "old");

  assertEquals(await api(node, { reset: { handle, pw: "a good password" } }), {
    ok: true,
    message: "Your password is set. You can sign in now.",
  });
  const hash = String(await a.db.one`SELECT pw FROM usr WHERE id = ${1}`);
  assertNotEquals(hash, "old");
  assertEquals(await pwVerify("a good password", hash), true);
  assertEquals(await a.db.one`SELECT COUNT(*) FROM sess`, 0);

  // the same link a second time does nothing, whatever it carries
  assertEquals(await api(node, { reset: { handle, pw: "another password" } }), {
    ok: false,
    message: "This link is no longer valid. Please request a new one.",
  });
  assertEquals(await pwVerify("a good password", String(await a.db.one`SELECT pw FROM usr WHERE id = ${1}`)), true);
  await a.db.close();
});
