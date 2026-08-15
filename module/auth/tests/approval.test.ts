import { assertEquals, assertRejects } from "@std/assert";
import { ApiError, Db } from "@qino/qino";
import { requireApproval } from "@qino/qino/auth";

import { approval, decideApproval } from "../approval.ts";
import dbSchema from "../dbschema.json" with { type: "json" };

import type { App, Ctx } from "@qino/qino";

Deno.test("an action approval is user-bound, intent-bound and consumed once", async () => {
  const db = new Db("sqlite::memory:");
  await db.migrate(dbSchema);
  await db.exec`CREATE TABLE usr (id INTEGER PRIMARY KEY, email TEXT, firstname TEXT, lastname TEXT)`;
  await db.loadTables();
  const sent: unknown[] = [];
  const channel = {
    name: "web_push",
    label: "Web Push",
    reach: async () => 1,
    send: async (_app: App, _to: unknown, message: unknown) => (sent.push(message), 1),
  };
  const app = {
    db,
    settings: { auth: { approval: { ttl: 600, pendingLimit: 10, channels: "web_push" } } },
    modules: {
      all: () => ({ web_push: { name: "web_push", plugin: { messagingChannel: channel } } }),
      linked: () => true,
    },
    t: (strings: TemplateStringsArray) => Promise.resolve(strings.join("")),
  } as unknown as App;
  const ctx = {
    app,
    userId: 7,
    logId: Promise.resolve(null),
    req: { appUrl: "/", url: new URL("https://example.test/api/store/add") },
  } as unknown as Ctx;
  const need = { action: "store.add", summary: "Add example store", details: { url: "https://store.test" }, requester: "MCP chatbot" };
  const request = async () => {
    let error: unknown;
    try { await requireApproval(ctx, undefined, need); } catch (e) { error = e; }
    assertEquals((error as { status?: number })?.status, 428);
    const id = /\[([A-Za-z0-9_-]{32})\]/.exec((error as Error).message)?.[1];
    if (!id) throw error;
    return id;
  };

  try {
    const id = await request();
    assertEquals((await approval(app, 7, id))?.status, "pending");
    assertEquals((await approval(app, 7, id))?.channel, "web_push");
    assertEquals(sent.length, 1);

    await decideApproval(app, 8, id, "approved");
    assertEquals((await approval(app, 7, id))?.status, "pending");
    await decideApproval(app, 7, id, "approved");

    await assertRejects(
      () => requireApproval(ctx, id, { ...need, details: { url: "https://other.test" } }),
      ApiError,
      "does not match",
    );
    await requireApproval(ctx, id, need);
    assertEquals((await approval(app, 7, id))?.status, "consumed");
    await assertRejects(() => requireApproval(ctx, id, need), ApiError, "consumed");

    const expired = await request();
    await decideApproval(app, 7, expired, "approved");
    await db.table("auth_approval").update(expired, { expires: 1 });
    assertEquals((await approval(app, 7, expired))?.status, "expired");
  } finally {
    await db.close();
  }
});
