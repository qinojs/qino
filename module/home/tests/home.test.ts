import { App, requestStorage, toTools } from "@qino/qino";
import { assertEquals, assertRejects, assertThrows, Emitter, testContext } from "@qino/qino/tests";

import { actions, call, changed, entities, providers } from "../mod.ts";
import { api } from "../api.ts";
import "../plugin.ts";

import type { EventDecls } from "@qino/qino";
import type { Provider } from "../mod.ts";

const endpoint = { id: "same", name: "Sensor", state: 21, attributes: { unit: "°C" }, available: true };
const provider = (name: string): Provider => ({
  name,
  entities: () => Promise.resolve([structuredClone(endpoint)]),
  actions: () => Promise.resolve([{ id: "set", name: "Set", fields: { value: { required: true } } }]),
  call: (_app, action, input) => Promise.resolve({ action, input }),
});
const appOf = (...providers: Provider[]) => Object.assign(new Emitter(), {
  modules: { linked: () => providers.map((homeProvider) => ({ plugin: { homeProvider } })) },
}) as unknown as App;

Deno.test("home discovers independent providers and preserves state types and local IDs", async () => {
  const app = appOf(provider("one"), provider("two"));
  assertEquals(providers(app), ["one", "two"]);
  assertEquals(await entities(app), [{ ...endpoint, provider: "one" }, { ...endpoint, provider: "two" }]);
  assertEquals((await actions(app, "two"))[0].provider, "two");
  assertEquals(await call(app, "two", "set", { entities: ["same"], data: { value: false } }), {
    action: "set", input: { entities: ["same"], data: { value: false } },
  });
  assertEquals(providers(appOf()), []);
  assertEquals(await entities(appOf()), []);
  assertThrows(() => providers(appOf(provider("one"), provider("one"))), Error, "duplicate");
  assertThrows(() => call(app, "missing", "set"), Error, "not linked");
});

Deno.test("home observations are app-local and listener cleanup follows the module signal", async () => {
  const one = appOf(), two = appOf(), ctrl = new AbortController();
  const seen: unknown[] = [], other: unknown[] = [];
  one.on("home:change", (e) => { seen.push(e); }, { signal: ctrl.signal });
  two.on("home:change", (e) => { other.push(e); });
  await changed(one, "fake", endpoint.id, endpoint, null);
  await changed(one, "fake", endpoint.id, null, endpoint);
  ctrl.abort();
  await changed(one, "fake", endpoint.id, endpoint, null);
  assertEquals(seen, [
    { provider: "fake", id: "same", entity: endpoint, previous: null },
    { provider: "fake", id: "same", entity: null, previous: endpoint },
  ]);
  assertEquals(other, []);
  assertEquals((App.events as EventDecls)["home:change"].data["~standard"].validate(seen[0]).issues, undefined);
});

Deno.test("home tools use the common API, validate inputs and enforce user access", async () => {
  const tools = toTools({ home: api });
  const action = tools.find((t) => t.name === "home_provider_action_post")!;
  assertEquals(tools.map((t) => t.name), [
    "home_providers_get", "home_entities_get", "home_actions_get", "home_provider_entity_get", "home_provider_action_post",
  ]);
  const app = appOf(provider("fake"));
  const ctx = await testContext({ app, set: { user: { id: 7 } } });
  await requestStorage.run(ctx, async () => {
    assertEquals(await action.execute({ provider: "fake", action: "set", data: { value: 42 } }, ctx), {
      action: "set", input: { entities: undefined, data: { value: 42 } },
    });
    await assertRejects(() => action.execute({ provider: "fake", action: "set", entities: "wrong" }, ctx), Error, "Validation failed");
    await assertRejects(() => action.execute({ provider: "fake", action: "set", data: [] }, ctx), Error);
  });
  const guest = await testContext({ app });
  await requestStorage.run(guest, () => assertRejects(() => action.execute({ provider: "fake", action: "set" }, guest), Error));
});
