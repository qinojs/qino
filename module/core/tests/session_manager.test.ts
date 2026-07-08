// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "./deps.ts";
import { Session, SessionManager } from "../lib/SessionManager.ts";
import { RequestContext } from "../lib/RequestContext.ts";
import { fakeRender } from "./sqlFake.ts";

function fakeDb() {
  const calls: Array<[string, unknown[] | undefined]> = [];
  let rowResult: any = null;
  let insertId = 1;
  return {
    calls,
    setRow(row: any) {
      rowResult = row;
    },
    row(...a: any[]) {
      calls.push(fakeRender(a[0], a.slice(1)));
      return rowResult;
    },
    exec(...a: any[]) {
      calls.push(fakeRender(a[0], a.slice(1)));
      return { insertId: insertId++, affectedRows: 1 };
    },
    table(name: string) {
      return {
        insert(values: Record<string, unknown>) {
          calls.push([`INSERT INTO ${name}`, [values]]);
          return String(insertId++);
        },
      };
    },
  };
}

Deno.test("SessionManager: load returns existing session when token is known", async () => {
  const db = fakeDb();
  db.setRow({ id: 7, data: '{"liveUser":5}' });
  const sessions = new SessionManager(db as any);

  const res = await sessions.load("token-1");
  assertEquals(res.token, "token-1");
  assertEquals(res.id, "7");
  assertEquals(res.isNew, false);
  assertEquals(res.data.liveUser(), 5);
});

Deno.test("SessionManager: load creates session without valid cookie", async () => {
  const db = fakeDb();
  const sessions = new SessionManager(db as any);

  const res = await sessions.load();
  assertEquals(res.id, "1");
  assertEquals(res.isNew, true);
  assertEquals(res.token.length > 10, true);
  assertEquals(db.calls[0][0], "INSERT INTO sess");
  const values = db.calls[0][1]?.[0] as Record<string, unknown>;
  assertEquals(values.token, res.token);
  assertEquals(values.access, values.time);
  assertEquals(values.data, "{}");
});

Deno.test("SessionManager: regenerateId resets an existing session", async () => {
  const db = fakeDb();
  db.setRow({ id: 9 });
  const sessions = new SessionManager(db as any);

  const res = await sessions.regenerateId("old-token");
  assertEquals(res.id, "9");
  assertEquals(res.isNew, true);
  assertEquals(db.calls[1][0], "UPDATE sess SET token = ?, data = ?, `access` = ? WHERE id = ?");
  assertEquals((db.calls[1][1] as unknown[])[3], 9);
});

Deno.test("SessionManager: setCookieIfNew uses __Secure- prefix on sub-path mounts", () => {
  const sessions = new SessionManager(fakeDb() as any);
  const ctx = new RequestContext();
  ctx.app = { https: true } as any;
  ctx.appURL = "/app/";
  ctx.sess = { token: "token", isNew: true } as any;

  sessions.setCookieIfNew(ctx);
  assertEquals(ctx.responseHeaders.get("Set-Cookie"), "__Secure-qgSession=token; Path=/app/; HttpOnly;SameSite=Lax; Secure");
});

Deno.test("SessionManager: setCookieIfNew uses __Host- prefix at root", () => {
  const sessions = new SessionManager(fakeDb() as any);
  const ctx = new RequestContext();
  ctx.app = { https: true } as any;
  ctx.appURL = "/";
  ctx.sess = { token: "token", isNew: true } as any;

  sessions.setCookieIfNew(ctx);
  assertEquals(ctx.responseHeaders.get("Set-Cookie"), "__Host-qgSession=token; Path=/; HttpOnly;SameSite=Lax; Secure");
});

Deno.test("Session: touch debounces its own access updates", async () => {
  const db = fakeDb();
  const sess = new Session(db as any, 3, "tok", "{}", false);

  sess.touch(1);
  sess.touch(4);
  await new Promise((resolve) => setTimeout(resolve, 70));

  const updates = db.calls.filter(([sql]) => sql.startsWith("UPDATE sess SET `access`"));
  assertEquals(updates.length, 1);
  assertEquals((updates[0][1] as unknown[]).slice(1), [4, "3"]);
});

Deno.test("Session: parallel sessions touch independently", async () => {
  const db = fakeDb();
  const a = new Session(db as any, 1, "a", "{}", false);
  const b = new Session(db as any, 2, "b", "{}", false);

  a.touch(11);
  b.touch(22);
  await new Promise((resolve) => setTimeout(resolve, 70));

  const updates = db.calls.filter(([sql]) => sql.startsWith("UPDATE sess SET `access`"));
  assertEquals(updates.length, 2);
});
