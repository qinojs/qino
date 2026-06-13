// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "./deps.ts";
import { SessionManager } from "../lib/SessionManager.ts";
import { RequestContext } from "../lib/RequestContext.ts";

function fakeDb() {
  const calls: Array<[string, unknown[] | undefined]> = [];
  let rowResult: any = null;
  let insertId = 1;
  return {
    calls,
    setRow(row: any) {
      rowResult = row;
    },
    row(sql: string, params?: unknown[]) {
      calls.push([sql, params]);
      return rowResult;
    },
    exec(sql: string, params?: unknown[]) {
      calls.push([sql, params]);
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
  assertEquals(res.sessionToken, "token-1");
  assertEquals(res.sessId, "7");
  assertEquals(res.isNew, false);
  assertEquals(res.session.liveUser(), 5);
});

Deno.test("SessionManager: load creates session without valid cookie", async () => {
  const db = fakeDb();
  const sessions = new SessionManager(db as any);

  const res = await sessions.load();
  assertEquals(res.sessId, "1");
  assertEquals(res.isNew, true);
  assertEquals(res.sessionToken.length > 10, true);
  assertEquals(db.calls[0][0], "INSERT INTO sess");
  const values = db.calls[0][1]?.[0] as Record<string, unknown>;
  assertEquals(values.token, res.sessionToken);
  assertEquals(values.access, values.time);
  assertEquals(values.data, "{}");
});

Deno.test("SessionManager: regenerateId resets an existing session", async () => {
  const db = fakeDb();
  db.setRow({ id: 9 });
  const sessions = new SessionManager(db as any);

  const res = await sessions.regenerateId("old-token");
  assertEquals(res.sessId, "9");
  assertEquals(res.isNew, true);
  assertEquals(db.calls[1][0], "UPDATE sess SET token = ?, data = ?, `access` = ? WHERE id = ?");
  assertEquals((db.calls[1][1] as unknown[])[3], 9);
});

Deno.test("SessionManager: setCookie uses host cookie for https", () => {
  const sessions = new SessionManager(fakeDb() as any);
  const ctx = new RequestContext();
  ctx.app = { https: true } as any;
  ctx.appURL = "/app/";
  ctx.sessionToken = "token";

  sessions.setCookie(ctx);
  assertEquals(ctx.responseHeaders.get("Set-Cookie"), "__Host-qgSession=token; Path=/app/; HttpOnly;SameSite=Lax; Secure");
});

Deno.test("SessionManager: touch debounces access updates", async () => {
  const db = fakeDb();
  const sessions = new SessionManager(db as any);

  sessions.touch(1, 2);
  sessions.touch(3, 4);
  await new Promise((resolve) => setTimeout(resolve, 70));

  const updates = db.calls.filter(([sql]) => sql.startsWith("UPDATE sess SET `access`"));
  assertEquals(updates.length, 1);
  assertEquals((updates[0][1] as unknown[]).slice(1), [4, 3]);
});
