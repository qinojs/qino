import { requestStorage, toTools } from "@qino/qino";
import { assertEquals, assertRejects, assertThrows, testContext } from "@qino/qino/tests";

import { history, providers } from "../mod.ts";
import { api } from "../plugin.ts";

import type { App } from "@qino/qino";
import type { Provider } from "@qino/qino/home";

const period = { start: "2026-10-03T02:00:00+02:00", end: "2026-10-04T02:00:00+02:00" };
const provider: Provider = {
  name: "archive",
  entities: () => Promise.resolve([]), actions: () => Promise.resolve([]), call: () => Promise.resolve(null),
  history: (_app, entity, period) => Promise.resolve([{
    id: entity, name: entity, state: false, attributes: { period }, available: true, updated: period.start,
  }]),
};
const appOf = (...providers: Provider[]) => ({
  modules: { linked: () => providers.map((homeProvider) => ({ plugin: { homeProvider } })) },
}) as unknown as App;

Deno.test("home history discovers optional capabilities and preserves native samples with UTC periods", async () => {
  const app = appOf(provider, { ...provider, name: "live", history: undefined });
  assertEquals(providers(app), ["archive"]);
  assertEquals(await history(app, "archive", "same", period), [{
    id: "same", name: "same", state: false, available: true, updated: "2026-10-03T00:00:00.000Z",
    attributes: { period: { start: "2026-10-03T00:00:00.000Z", end: "2026-10-04T00:00:00.000Z" } },
  }]);
  assertThrows(() => history(app, "live", "same", period), Error, "does not support history");
  assertThrows(() => history(app, "missing", "same", period), Error, "not linked");
  assertThrows(() => history(app, "archive", "same", { start: period.end, end: period.start }), Error, "precede");
  assertThrows(() => history(app, "archive", "same", { ...period, start: "2026-10-03T00:00:00" }), Error, "timezone");
  assertThrows(() => history(app, "archive", "same", { ...period, start: "badZ" }), Error, "timezone");
  assertThrows(() => providers(appOf(provider, provider)), Error, "duplicate");
  assertEquals(await history(appOf({ ...provider, history: () => Promise.resolve([]) }), "archive", "same", period), []);
});

Deno.test("home history tools enforce access, required periods and upstream failures", async () => {
  const tools = toTools({ "home.history": api });
  assertEquals(tools.map((tool) => tool.name), ["homeHistory_providers_get", "homeHistory_provider_entity_get"]);
  const read = tools.find((tool) => tool.name.endsWith("provider_entity_get"))!;
  const app = appOf(provider), ctx = await testContext({ app, set: { user: { id: 7 } } });
  await requestStorage.run(ctx, async () => {
    assertEquals((await read.execute({ provider: "archive", entity: "same", ...period }, ctx) as unknown[]).length, 1);
    await assertRejects(() => read.execute({ provider: "archive", entity: "same" }, ctx), Error, "Validation failed");
  });
  const guest = await testContext({ app });
  await requestStorage.run(guest, () => assertRejects(() => read.execute({ provider: "archive", entity: "same", ...period }, guest), Error, "Access denied"));
  await assertRejects(() => history(appOf({ ...provider, history: () => Promise.reject(new Error("offline")) }), "archive", "same", period), Error, "offline");
});
