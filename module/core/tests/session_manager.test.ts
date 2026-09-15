// deno-lint-ignore-file no-explicit-any
import { assertEquals, testContext } from "./deps.ts";
import { unixTime } from "../lib/util.ts";
import { Session, SessionManager } from "../lib/SessionManager.ts";
import { fakeRender } from "./sqlFake.ts";
import { fakeSettings } from "./appFake.ts";

const fakeApp = (db: unknown) => ({ db, settings: fakeSettings() }) as any;

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
          return Promise.resolve(String(insertId++));
        },
        update(id: unknown, values: Record<string, unknown>) {
          calls.push([`UPDATE ${name}`, [id, values]]);
          return Promise.resolve(String(id));
        },
      };
    },
  };
}

Deno.test("SessionManager: load returns existing session when token is known", async () => {
  const db = fakeDb();
  db.setRow({ id: 7, data: '{"core":{"userId":5}}', access: unixTime() });
  const sessions = new SessionManager(fakeApp(db));

  const res = await sessions.load("token-1");
  assertEquals(res.token, "token-1");
  assertEquals(res.id, "7");
  assertEquals(res.isNew, false);
  assertEquals(res.data.core.userId(), 5);
});

Deno.test("SessionManager: load creates session without valid cookie", async () => {
  const db = fakeDb();
  const sessions = new SessionManager(fakeApp(db));

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
  const sessions = new SessionManager(fakeApp(db));

  const res = await sessions.regenerateId("old-token");
  assertEquals(res.id, "9");
  assertEquals(res.isNew, true);
  assertEquals(db.calls[1][0], "UPDATE sess");
  const [id, values] = db.calls[1][1] as [unknown, Record<string, unknown>];
  assertEquals(id, 9);
  assertEquals(values.token, res.token);
  assertEquals(values.data, "{}");
});

Deno.test("SessionManager: setCookieIfNew uses __Secure- prefix on sub-path mounts", async () => {
  const sessions = new SessionManager(fakeApp(fakeDb()));
  const ctx = await testContext({ url: "http://qino.test/app/", appUrl: "/app/", app: { https: true }, sess: { token: "token", isNew: true } });

  sessions.setCookieIfNew(ctx);
  assertEquals(ctx.res.headers.get("Set-Cookie"), "__Secure-qinoSess=token; Path=/app/; HttpOnly;SameSite=Lax; Secure");
});

Deno.test("SessionManager: setCookieIfNew uses __Host- prefix at root", async () => {
  const sessions = new SessionManager(fakeApp(fakeDb()));
  const ctx = await testContext({ app: { https: true }, sess: { token: "token", isNew: true } });

  sessions.setCookieIfNew(ctx);
  assertEquals(ctx.res.headers.get("Set-Cookie"), "__Host-qinoSess=token; Path=/; HttpOnly;SameSite=Lax; Secure");
});

Deno.test("SessionManager: setCookieIfNew sends the cookie only once per session", async () => {
  const sessions = new SessionManager(fakeApp(fakeDb()));
  const ctx = await testContext({ app: { https: true }, sess: { token: "token", isNew: true, cookieSent: false } });

  sessions.setCookieIfNew(ctx);
  sessions.setCookieIfNew(ctx);
  assertEquals(ctx.res.headers.getSetCookie().length, 1);
});

Deno.test("Session: touch debounces its own access updates", async () => {
  const db = fakeDb();
  const sess = new Session(db as any, 3, "tok", "{}", false);

  sess.touch(1);
  sess.touch(4);
  await new Promise((resolve) => setTimeout(resolve, 70));

  const updates = db.calls.filter(([sql]) => sql === "UPDATE sess");
  assertEquals(updates.length, 1);
  const [id, values] = updates[0][1] as [unknown, Record<string, unknown>];
  assertEquals(id, "3");
  assertEquals(values.usr_id, 4);
});

Deno.test("Session: parallel sessions touch independently", async () => {
  const db = fakeDb();
  const a = new Session(db as any, 1, "a", "{}", false);
  const b = new Session(db as any, 2, "b", "{}", false);

  a.touch(11);
  b.touch(22);
  await new Promise((resolve) => setTimeout(resolve, 70));

  const updates = db.calls.filter(([sql]) => sql === "UPDATE sess");
  assertEquals(updates.length, 2);
});

Deno.test("SessionManager: a session idle past the limit is not resumed", async () => {
  const db = fakeDb();
  db.setRow({ id: 7, data: "{}", access: unixTime() - 31 * 24 * 60 * 60 }); // past the 30-day default
  const sessions = new SessionManager(fakeApp(db));

  const res = await sessions.load("token-1");
  assertEquals(res.isNew, true); // a fresh session, not the known row
  assertEquals(res.id, "1");
});

Deno.test("SessionManager: settings.core.sess.maxIdle overrides the default", async () => {
  const db = fakeDb();
  db.setRow({ id: 7, data: "{}", access: unixTime() - 60 });
  const app = fakeApp(db);
  app.settings = fakeSettings({ core: fakeSettings({ sess: fakeSettings({ maxIdle: 30 }) }) });

  const res = await new SessionManager(app).load("token-1");
  assertEquals(res.isNew, true);
});

Deno.test("SessionManager: an unreadable access time expires the session", async () => {
  const db = fakeDb();
  db.setRow({ id: 7, data: "{}" }); // no access column -> must not read as "still fresh"
  const res = await new SessionManager(fakeApp(db)).load("token-1");
  assertEquals(res.isNew, true);
});
