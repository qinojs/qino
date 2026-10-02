import { assertEquals, assertRejects } from "@std/assert";
import { AccessError, ApiError, NotFoundError, invoke, requestStorage } from "@qino/qino";
import { testContext } from "@qino/qino/tests";

import { api } from "../api.ts";

import type { App } from "@qino/qino";

async function fixture(superuser = true, userId = 1) {
  const calls: unknown[] = [];
  const selected = {
    name: "custom", label: "Custom", contact: "phone",
    send: (_app: App, to: unknown, msg: unknown) => { calls.push({ to, msg }); return Promise.resolve(2); },
  };
  const ctx = await testContext({ userId, app: {
    modules: { linked: () => [{ plugin: { messagingChannel: selected } }] },
    db: { table: () => ({ row: () => ({ superuser }) }) },
  } });
  return { calls, run: (method: string, path: string, params = {}) => requestStorage.run(ctx, () => invoke(api, method, path, params)) };
}

Deno.test("messaging api lists channel data and sends through the selected channel", async () => {
  const { calls, run } = await fixture();
  assertEquals(await run("GET", "/channels"), [{ name: "custom", label: "Custom", contact: "phone", color: undefined }]);
  const to = { usr: [1, 2], grp: 3 };
  const msg = { text: "Hello", format: "md", template: null, url: "/news", replyTo: "reply@example.test" };
  assertEquals(await run("POST", "/channels/custom/send", { to, msg }), 2);
  assertEquals(calls, [{ to, msg }]);
  assertEquals(await run("POST", "/channels/custom/send", { to: { usr: 1 }, msg: "Hello user" }), 2);
  assertEquals(await run("POST", "/channels/custom/send", { to: { grp: 3 }, msg: "Hello group" }), 2);
});

Deno.test("messaging api rejects invalid input before sending", async () => {
  const { calls, run } = await fixture();
  const send = (to: unknown, msg: unknown = "Hello") => run("POST", "/channels/custom/send", { to, msg });
  for (const to of [{}, { usr: [] }, { usr: 0 }, { usr: "1" }, { usr: [1, -2] }, { grp: 1.5 }, { all: "true" }])
    await assertRejects(() => send(to), ApiError);
  await assertRejects(() => run("POST", "/channels/missing/send", { to: { usr: 1 }, msg: "Hello" }), NotFoundError);
  assertEquals(calls, []);
});

Deno.test("messaging api passes only usr and grp to the channel", async () => {
  const { calls, run } = await fixture();
  await assertRejects(() => run("POST", "/channels/custom/send", { to: { all: true }, msg: "Hello" }), ApiError);
  await run("POST", "/channels/custom/send", { to: { email: "a@example.test", all: true, usr: 1 }, msg: "Hello" });
  assertEquals(calls, [{ to: { usr: 1 }, msg: "Hello" }]);
});

Deno.test("messaging api lets signed-in users list channels but restricts sending", async () => {
  const { calls, run } = await fixture(false);
  assertEquals(await run("GET", "/channels"), [{ name: "custom", label: "Custom", contact: "phone", color: undefined }]);
  await assertRejects(() => run("POST", "/channels/custom/send", { to: { usr: 1 }, msg: "Hello" }), AccessError);
  assertEquals(calls, []);
});

Deno.test("messaging api denies anonymous channel listings and sending", async () => {
  const { calls, run } = await fixture(false, 0);
  await assertRejects(() => run("GET", "/channels"), AccessError);
  await assertRejects(() => run("POST", "/channels/custom/send", { to: { usr: 1 }, msg: "Hello" }), AccessError);
  assertEquals(calls, []);
});
