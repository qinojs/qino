import { assertEquals, assertStringIncludes } from "@qino/qino/tests";
import { datapoints, enable } from "@qino/qino/home";

import backendApi from "../nodeApi.ts";
import { measurements } from "../datapoints.ts";
import { fixture } from "./fixture.ts";

import type { Node } from "@qino/qino/cms";

Deno.test("home backend selects and stops recording while a provider is disabled", async () => {
  const { app, provider, close } = await fixture(), node = { app } as Node;
  try {
    await enable(app, provider, false);
    assertEquals(await backendApi(node, { datapoint: { provider, entity: "<meter>", record: true } }), { ok: true, message: "Datapoint saved." });
    const output = String(await measurements(node));
    assertStringIncludes(output, "&lt;meter&gt;");
    assertStringIncludes(output, "checked");
    const id = (await datapoints(app))[0].id;
    assertEquals(await backendApi(node, { datapoint: { id, record: false } }), { ok: true, message: "Datapoint saved." });
    assertEquals((await datapoints(app))[0].record, false);
    assertEquals((await backendApi(node, { datapoint: { id, record: "false" } }) as { ok: boolean }).ok, false);
    assertEquals((await backendApi(node, { datapoint: { provider, entity: 7 } }) as { ok: boolean }).ok, false);
  } finally { await close(); }
});

Deno.test("home backend creates manual datapoints without discovery and stores entered values", async () => {
  const { app, close } = await fixture({ manual: true }), node = { app } as Node;
  try {
    assertEquals(await backendApi(node, { config: { name: "Manual values", adapter: "manual" } }), { ok: true, message: "Provider saved." });
    const empty = String(await measurements(node));
    assertStringIncludes(empty, "Add datapoint");
    assertStringIncludes(empty, "Manual values (#2)");
    assertEquals(await backendApi(node, { datapoint: { provider: 2, entity: "temperature", name: "Temperature", unit: "°C", record: true } }), { ok: true, message: "Datapoint saved." });
    const id = (await datapoints(app))[0].id, time = Date.now() + 1000;
    assertEquals(await backendApi(node, { measurement: { id, value: 21.4, time } }), { ok: true, message: "Measurement saved." });
    assertEquals((await datapoints(app))[0].value, 21.4);
    const output = String(await measurements(node));
    assertStringIncludes(output, "Enter measurement");
    assertStringIncludes(output, "21.4");
    assertEquals((await backendApi(node, { measurement: { id, value: "broken", time } }) as { ok: boolean }).ok, false);
    await backendApi(node, { datapoint: { id, record: false } });
    assertEquals(await backendApi(node, { measurement: { id, value: 99, time } }), { ok: false, message: "Enable recording before entering measurements" });
    assertEquals((await datapoints(app))[0].value, 21.4);
  } finally { await close(); }
});
