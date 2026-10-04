import { requestStorage } from "@qino/qino";
import { assertEquals, assertStringIncludes, testContext } from "@qino/qino/tests";
import { datapoints, enable } from "@qino/qino/home";

import backendApi from "../nodeApi.ts";
import { measurements } from "../datapoints.ts";
import { fixture } from "./fixture.ts";

import type { Node } from "@qino/qino/cms";

Deno.test("home backend selects and stops recording while a provider is disabled", async () => {
  const { app, provider, close } = await fixture(), node = { app } as Node;
  try {
    await enable(app, provider, false);
    const user = await testContext({ app, set: { app, user: { id: 7 } } });
    await requestStorage.run(user, async () => {
      assertEquals(await backendApi(node, { datapoint: { provider, entity: "<meter>", record: true } }), { ok: true, message: "Datapoint saved." });
      const output = String(await measurements(node));
      assertStringIncludes(output, "&lt;meter&gt;");
      assertStringIncludes(output, "checked");
      const id = (await datapoints(app))[0].id;
      assertEquals(await backendApi(node, { datapoint: { id, provider, entity: "<meter>", record: false } }), { ok: true, message: "Datapoint saved." });
      assertEquals((await datapoints(app))[0].record, false);
      assertEquals((await backendApi(node, { datapoint: { id, provider, entity: "<meter>", record: "false" } }) as { ok: boolean }).ok, false);
    });
    const guest = await testContext({ app, set: { app } });
    await requestStorage.run(guest, async () => {
      assertEquals(await backendApi(node, { datapoint: { provider, entity: "<meter>", record: true } }), { ok: false, message: "Access denied" });
    });
  } finally { await close(); }
});
