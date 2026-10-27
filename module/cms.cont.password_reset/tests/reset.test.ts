import { assertEquals, assertNotEquals } from "@std/assert";
import { Db, pwVerify, requestStorage } from "@qino/qino";
import { fakeT, ticketDbSchema as ticketSchema } from "@qino/qino/tests";
import { issue } from "@qino/qino/ticket";

import * as plugin from "../plugin.ts";
import api, { PURPOSE } from "../nodeApi.ts";

import type { Node } from "@qino/qino/cms";

async function app() {
  const db = new Db("sqlite::memory:");
  await db.migrate(ticketSchema);
  await db.exec`CREATE TABLE usr (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, pw TEXT, active INTEGER)`;
  await db.exec`CREATE TABLE sess (id INTEGER PRIMARY KEY AUTOINCREMENT, usr_id INTEGER)`;
  await db.exec`CREATE TABLE client (id INTEGER PRIMARY KEY AUTOINCREMENT, usr_id INTEGER)`;
  await db.exec`CREATE TABLE client_usr (client_id INTEGER, usr_id INTEGER, save_login INTEGER)`;
  await db.exec`CREATE TABLE usr_contact (usr_id INTEGER, type TEXT, address TEXT)`;
  await db.loadTables();
  await db.table("usr").insert({ username: "one@qino.test", pw: "old", active: 1 });
  await db.table("sess").insert({ usr_id: 1 });
  await db.table("client").insert({ usr_id: 1 });
  await db.table("client_usr").insert({ client_id: 1, usr_id: 1, save_login: 1 });
  await db.table("usr_contact").insert({ usr_id: 1, type: "email", address: "one@qino.test" });
  return {
    db,
    [Symbol.asyncDispose]: () => db.close(),
    t: fakeT,
    modules: { linked: () => [{ name: "cms.cont.password_reset", plugin }] },
    // deno-lint-ignore no-explicit-any
  } as any;
}

Deno.test("the link sets the password once and logs out every session and remembered device", async () => {
  await using a = await app();
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
  assertEquals(await a.db.row`SELECT c.usr_id, cu.save_login FROM client c, client_usr cu`, { usr_id: 0, save_login: 0 });

  // the same link a second time does nothing, whatever it carries
  assertEquals(await api(node, { reset: { handle, pw: "another password" } }), {
    ok: false,
    message: "This link is no longer valid. Please request a new one.",
  });
  assertEquals(await pwVerify("a good password", String(await a.db.one`SELECT pw FROM usr WHERE id = ${1}`)), true);
});

Deno.test("an account gets three links an hour; each request counts a little suspicious, one past that more", async () => {
  await using a = await app();
  const weights: number[] = [];
  a.fire = (name: string, e: { weight: number }) => (name === "suspicious" && weights.push(e.weight), Promise.resolve(e));
  a.url = () => Promise.resolve("https://qino.test/");
  const node = { app: a, url: () => Promise.resolve("/reset") } as unknown as Node;
  const links = () => a.db.one`SELECT COUNT(*) FROM ticket WHERE purpose = ${PURPOSE}`;
  const message = { ok: true, message: "If that address has an account, a link is on its way. Please also check your spam folder." };

  await requestStorage.run({} as never, async () => {
    assertEquals(await api(node, { request: "nobody@qino.test" }), message); // same answer, nothing sent
    for (let i = 0; i < 4; i++) assertEquals(await api(node, { request: "One@qino.test" }), message);
    assertEquals(await links(), 3); // the fourth within the hour sends nothing, and says the same
  });
  assertEquals(weights, [1, 1, 1, 1, 3]);
});
