// deno-lint-ignore-file no-explicit-any
import { assertEquals, fakeRender } from "@qino/qino/tests";

import { identity, resolveUser } from "../plugin.ts";

const PROVIDER = { name: "github", auto_create: 1, allowed_domains: "" };

/** A database that answers from the two rows a login looks at, and records what it wrote. */
function fakeDb({ link, usr }: { link?: number; usr?: number } = {}) {
  const inserted: Array<[string, Record<string, unknown>]> = [];
  const execs: string[] = [];
  return {
    inserted,
    execs,
    row: (...a: any[]) => Promise.resolve(fakeRender(a[0], a.slice(1))[0].includes("oauth_provider_usr") && link ? { usr_id: link } : null),
    one: () => Promise.resolve(usr ?? null),
    exec: (...a: any[]) => { execs.push(fakeRender(a[0], a.slice(1))[0]); return Promise.resolve({ affectedRows: 1 }); },
    table: (name: string) => ({
      insert: (row: Record<string, unknown>) => { inserted.push([name, row]); return Promise.resolve(99); },
    }),
  };
}

const ctxWith = (db: any, userId = 0) => ({ app: { db }, userId }) as any;

const github = (over: Record<string, unknown> = {}) =>
  identity({ id: 4711, email: "kim@example.com", email_verified: true, ...over });

Deno.test("auth.oauth: a remembered sub decides, without looking at the e-mail", async () => {
  const db = fakeDb({ link: 7 });
  assertEquals(await resolveUser(ctxWith(db), PROVIDER, github({ email: "" })), 7);
  assertEquals(db.inserted.length, 0); // nothing new to remember
  assertEquals(db.execs.some((s) => s.includes("UPDATE oauth_provider_usr")), true); // last_used
});

Deno.test("auth.oauth: an unknown sub falls back to the verified e-mail and is remembered", async () => {
  const db = fakeDb({ usr: 3 });
  assertEquals(await resolveUser(ctxWith(db), PROVIDER, github()), 3);
  assertEquals(db.inserted, [["oauth_provider_usr", { provider: "github", sub: "4711", usr_id: 3, created: db.inserted[0][1].created, last_used: db.inserted[0][1].last_used }]]);
});

Deno.test("auth.oauth: an unverified e-mail is refused", async () => {
  const db = fakeDb();
  assertEquals(await resolveUser(ctxWith(db), PROVIDER, github({ email_verified: false })), 0);
  assertEquals(db.inserted.length, 0);
});

Deno.test("auth.oauth: auto_create off means an unknown e-mail creates nobody", async () => {
  const db = fakeDb();
  assertEquals(await resolveUser(ctxWith(db), { ...PROVIDER, auto_create: 0 }, github()), 0);
  assertEquals(db.inserted.length, 0);
});

Deno.test("auth.oauth: signed in, the round trip connects the provider to whoever is here", async () => {
  const db = fakeDb();
  assertEquals(await resolveUser(ctxWith(db, 5), PROVIDER, github({ email: "someone.else@example.com" })), 5);
  assertEquals(db.inserted[0][1].usr_id, 5); // not the account owning that e-mail
});

Deno.test("auth.oauth: signed in, an identity linked to someone else is refused, not switched to", async () => {
  const db = fakeDb({ link: 7 });
  assertEquals(await resolveUser(ctxWith(db, 5), PROVIDER, github()), 0);
});

Deno.test("auth.oauth: allowed_domains rejects a foreign e-mail but spares an existing link", async () => {
  const p = { ...PROVIDER, allowed_domains: "example.com" };
  assertEquals(await resolveUser(ctxWith(fakeDb({ usr: 3 })), p, github({ email: "kim@other.com" })), 0);
  assertEquals(await resolveUser(ctxWith(fakeDb({ link: 7 })), p, github({ email: "" })), 7); // Apple stops sending one
});

Deno.test("auth.oauth: identity reads the id of both provider kinds", () => {
  assertEquals(identity({ sub: "oidc-1" }).sub, "oidc-1");
  assertEquals(identity({ id: 4711 }).sub, "4711");
  assertEquals(identity({}).sub, ""); // nothing to remember, e-mail stays the only way
});
