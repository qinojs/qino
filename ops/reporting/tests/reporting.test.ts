import { Db } from "@qino/qino";
import { assertEquals, assertRejects, reportingIntake as intake, reportingServerDbSchema as serverSchema } from "@qino/qino/tests";

import { relative, report, send } from "../plugin.ts";

import type { App } from "@qino/qino";

const errorSchema = {
  properties: {
    m_error_report: {
      additionalProperties: {
        properties: {
          id: { type: "integer", "x-index": "primary", "x-autoincrement": true },
          time: { type: "string", format: "date-time" },
          source: { type: "string" }, message: { type: "string" }, file: { type: "string" },
          line: { type: "integer" }, col: { type: "integer" }, prio: { type: "string" },
        },
      },
    },
  },
};

async function sqlite(schema: typeof errorSchema | typeof serverSchema) {
  const db = new Db("sqlite::memory:");
  await db.migrate(schema, { patch: true });
  db.schema = schema;
  await db.loadTables();
  return db;
}

/** Settings like the real ones: awaited they read, called they write. */
function settings(values: Record<string, unknown>) {
  const leaf = (key: string) => Object.assign((v: unknown) => { values[key] = v; }, {
    then: (resolve: (v: unknown) => void) => resolve(values[key]),
  });
  return { reporting: new Proxy({}, { get: (_, key) => leaf(String(key)) }) };
}

const signal = new AbortController().signal;

Deno.test("reporting: files relative to qino or the app, URLs without their origin", () => {
  const roots: [string, string][] = [["file:///srv/qino/", "qino/"], ["file:///srv/site/", "app/"]];
  assertEquals(relative("file:///srv/qino/module/core/lib/App.ts", roots), "qino/module/core/lib/App.ts");
  assertEquals(relative("file:///srv/site/module/x/plugin.ts", roots), "app/module/x/plugin.ts");
  assertEquals(relative("https://a.ch/sub/pub/main.js", roots), "/sub/pub/main.js");
  assertEquals(relative("anonymous", roots), "anonymous");
});

Deno.test("reporting: new errors go to the server, grouped; nothing new is quiet until the heartbeat", async () => {
  const db = await sqlite(errorSchema);
  const server = { db: await sqlite(serverSchema) } as unknown as App;
  const values: Record<string, unknown> = { url: "https://server.example/" };
  const app = {
    db, dir: "/srv/site/", settings: settings(values),
    url: () => Promise.resolve("https://a.ch/"),
    modules: { linked: () => [{ name: "core" }, { name: "cms" }] },
  } as unknown as App;
  const posted: Request[] = [];
  const fetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const req = new Request(input, init);
    posted.push(req.clone());
    const failed = await intake(server, req.headers.get("authorization") ?? "", await req.json(), "", true);
    return new Response(JSON.stringify(failed ? { error: failed } : { ok: true }), { status: failed ? 403 : 200 });
  };
  try {
    const add = (o: Record<string, unknown>) => db.table("m_error_report").insert({ time: "2026-10-20 10:00:00", prio: "error", message: "boom", line: 1, col: 1, ...o });
    await add({ source: "deno", file: "file:///srv/site/module/x/plugin.ts" });
    await add({ source: "deno", file: "file:///srv/site/module/x/plugin.ts", time: "2026-10-20 11:00:00" });
    await add({ source: "404", file: "/missing" });

    const sent = await report(app, 0, 3);
    assertEquals(sent.modules, ["cms", "core"]);
    assertEquals(sent.errors.map((e) => [e.file, e.hits, e.first_seen, e.last_seen]),
      [["app/module/x/plugin.ts", 2, "2026-10-20 10:00:00", "2026-10-20 11:00:00"]]);

    await send(app, { signal });
    assertEquals(posted.length, 1);
    assertEquals(new URL(posted[0].url).pathname, "/reporting");
    assertEquals(values.sent, 3);
    assertEquals(await server.db.query`SELECT instance, file, hits FROM reporting_error`,
      [{ instance: values.id, file: "app/module/x/plugin.ts", hits: 2 }]);

    await send(app, { signal }); // nothing new, heartbeat not due
    assertEquals(posted.length, 1);
    values.sentAt = 0;
    await send(app, { signal }); // heartbeat: same id, same key
    assertEquals(posted.length, 2);
    assertEquals(await server.db.one`SELECT COUNT(*) FROM reporting_instance`, 1);

    values.key = "x".repeat(44); // a key the server does not know
    await add({ source: "deno", file: "file:///srv/site/y.ts" });
    await assertRejects(() => send(app, { signal }), Error, "reporting server answered 403");
    assertEquals(values.sent, 3); // retried with the next run
  } finally {
    globalThis.fetch = fetch;
    await db.close();
    await server.db.close();
  }
});

Deno.test("reporting: without a server address nothing is sent", async () => {
  const app = { settings: settings({}) } as unknown as App;
  await send(app, { signal }); // would throw on the missing db
});
