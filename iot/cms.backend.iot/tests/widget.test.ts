import { test } from "node:test";
import { assert, assertEquals, assertStringIncludes } from "@qino/qino/tests";

import { backendDashboardWidget } from "../plugin.ts";
import { fixture } from "./fixture.ts";

import type { Node } from "@qino/qino/cms";

test("the dashboard widget shows stale datapoints first, then the latest values, each linked", async () => {
  const { app, provider, close } = await fixture();
  try {
    const now = Date.now();
    const add = (entity: string, interval: number, value: number | null, time: number | null) => app.db.table("iot_datapoint")
      .insert({ provider, entity, path: "", name: entity, unit: "°C", type: "number", mapping: "{}", interval, record: false, value, time });
    const silent = await add("silent", 60, 20, now - 3600_000); // twice its interval passed long ago
    const fresh = await add("fresh", 60, 21.5, now - 1000);
    await add("never", 0, null, null); // no value, no interval: nothing to show
    const page = { app, url: () => Promise.resolve("/backend/iot#cmspid9") } as unknown as Node;
    const out = String(await backendDashboardWidget(app, page));
    assertStringIncludes(out, "Stale:<td>1");
    assertStringIncludes(out, `<a href="/backend/iot?datapoint=${silent}#cmspid9">silent</a>`);
    assertStringIncludes(out, `<a href="/backend/iot?datapoint=${fresh}#cmspid9">fresh</a>`);
    assert(out.indexOf(">silent<") < out.indexOf(">fresh<"));
    assertEquals(out.includes(">never<"), false);
  } finally {
    await close();
  }
});
