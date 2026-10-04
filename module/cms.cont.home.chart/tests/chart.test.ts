import { App, requestStorage } from "@qino/qino";
import { assertEquals, assertStringIncludes, fakeT, testContext } from "@qino/qino/tests";
import { configure, save } from "@qino/qino/home";
import { record } from "@qino/qino/home.record";

import { chart } from "../chart.ts";
import { cms } from "../plugin.ts";

import type { Node } from "@qino/qino/cms";

async function fixture() {
  const dir = await Deno.makeTempDir({ prefix: "qino-home-chart-test-" }), app = new App({ dir, db: "sqlite::memory:" });
  await Deno.writeTextFile(`${dir}/plugin.ts`, `export const homeProvider = {
    name: "fake", entities: async () => [], actions: async () => [], call: async () => null,
  };`);
  for (const name of ["home", "home.history", "cron", "home.record"]) app.modules.add(new URL(`../../${name}/plugin.ts`, import.meta.url));
  app.modules.add(new URL(`file://${dir}/plugin.ts`), "fake.adapter");
  await app.init(); app.t = fakeT;
  const provider = await save(app, { name: "House", adapter: "fake", url: "" });
  return { app, provider, close: async () => { app.modules.unlink("home.record"); app.modules.unlink("cron"); await app.db.close(); await Deno.remove(dir, { recursive: true }); } };
}

const start = Date.parse("2026-01-01T00:00:00Z");

Deno.test("home chart SVG uses elapsed time, interrupts paths and escapes units", () => {
  const output = String(chart([{ time: start, value: 1 }, { time: start + 60_000, value: 2 }, { time: start + 120_000, value: null }, { time: start + 540_000, value: 4 }], { start, end: start + 600_000, unit: '<script>attack()</script>' }));
  assertStringIncludes(output, "M60.00,220.00 L130.00,153.33 M690.00,20.00");
  assertStringIncludes(output, "&lt;script&gt;attack()&lt;/script&gt;");
  assertEquals(output.includes("<script>"), false);
  assertEquals(chart([{ time: start, value: null }], { start, end: start + 600_000 }), undefined);
});

Deno.test("home chart CMS uses numeric datapoints, bounded history and protected access", async () => {
  const { app, provider, close } = await fixture();
  try {
    const id = await configure(app, { provider, entity: "meter", unit: "kWh", record: true });
    await record(app, id, 10, start); await record(app, id, 12, start + 60_000);
    const node = { app, settings: { datapoint: () => id, source: () => "local", consumption: () => true, maxGap: () => 180, hours: () => 24 } } as unknown as Node;
    const guest = await testContext({ app, set: { app } });
    await requestStorage.run(guest, async () => assertStringIncludes(String(await cms.node.render(node)), "Access denied"));
    const user = await testContext({ app, set: { app, user: { id: 7 } } });
    await requestStorage.run(user, async () => {
      const output = String(await cms.node.parts.plot(node, { vars: { start: new Date(start).toISOString(), end: new Date(start + 600_000).toISOString() } }));
      assertStringIncludes(output, "Counter consumption per chart interval");
      assertStringIncludes(output, "<td>2</td>");
      assertStringIncludes(String(await cms.node.parts.plot(node, { vars: { start: "bad", end: "bad" } })), "timezone");
    });
  } finally { await close(); }
});
