import { assertEquals } from "@std/assert";
import { Db } from "@qino/qino";
import { requireApproval } from "@qino/qino/auth";

import { approval, consumeApproval, decideApproval, requestApproval } from "../approval.ts";
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

  try {
    const created = await requestApproval(ctx, need);
    assertEquals(created.status, "pending");
    assertEquals(created.channel, "web_push");
    assertEquals(sent.length, 1);

    await decideApproval(app, 8, created.id, "approved");
    assertEquals((await approval(app, 7, created.id))?.status, "pending");
    await decideApproval(app, 7, created.id, "approved");

    assertEquals(await consumeApproval(app, 7, created.id, need.action, { url: "https://other.test" }), false);
    assertEquals(await consumeApproval(app, 7, created.id, need.action, need.details), true);
    assertEquals(await consumeApproval(app, 7, created.id, need.action, need.details), false);
    assertEquals((await approval(app, 7, created.id))?.status, "consumed");

    const expired = await requestApproval(ctx, need);
    await decideApproval(app, 7, expired.id, "approved");
    await db.table("auth_approval").update(expired.id, { expires: 1 });
    assertEquals((await approval(app, 7, expired.id))?.status, "expired");

    await requireApproval(ctx, undefined, need).then(
      () => { throw new Error("approval unexpectedly passed"); },
      (error) => assertEquals((error as { status: number }).status, 428),
    );
  } finally {
    await db.close();
  }
});
