import { App, requestStorage } from "@qino/qino";
import { assertEquals, assertStringIncludes, fakeT, testContext } from "@qino/qino/tests";

import { chart, points } from "../chart.ts";
import { cms } from "../plugin.ts";

import type { Node } from "@qino/qino/cms";
import type { Entity } from "@qino/qino/home";

const start = Date.parse("2026-01-01T00:00:00Z");
const sample = (seconds: number, state: unknown, available = true, unit = "kWh"): Entity => ({
  id: "meter", name: "Meter", state, attributes: {}, available, unit, updated: new Date(start + seconds * 1000).toISOString(),
});

Deno.test("home charts preserve counter resets, outages, unit changes, gaps and numeric types", () => {
  const samples = [sample(0, "10"), sample(60, 12), sample(120, 2), sample(180, 3), sample(240, 4, false), sample(300, 5), sample(360, 6), sample(420, 7, true, "Wh"), sample(900, 8, true, "Wh")];
  assertEquals(points(samples, { consumption: true, maxGap: 180 }).map((point) => point.value), [null, 2, null, 1, null, null, 1, null, null]);
  assertEquals(points([sample(0, false), sample(1, ""), sample(2, "12x"), sample(3, {}), sample(4, "0"), sample(5, -1)]).map((point) => point.value), [null, null, null, null, 0, -1]);
  assertEquals(points([sample(60, 2), sample(0, 1)]).map((point) => point.value), [1, 2]);
  assertEquals(points(samples, { consumption: true, maxGap: 0 }).at(-1)!.value, 1);
});

Deno.test("home chart SVG uses actual timestamps, interrupts paths and escapes units", () => {
  const output = String(chart([sample(0, 1), sample(60, 2), sample(120, null, false), sample(540, 4, true, '<script>attack()</script>')], { start, end: start + 600_000 }));
  assertStringIncludes(output, "M60.00,220.00 L130.00,153.33 M690.00,20.00");
  assertStringIncludes(output, "&lt;script&gt;attack()&lt;/script&gt;");
  assertEquals(output.includes("<script>"), false);
  assertEquals(chart([sample(0, false)], { start, end: start + 600_000 }), undefined);
});

Deno.test("home chart CMS uses history access checks and supports explicit period and consumption", async () => {
  const dir = await Deno.makeTempDir(), app = new App({ dir, db: "sqlite::memory:" });
  app.modules.add(new URL("../../home/plugin.ts", import.meta.url));
  app.modules.add(new URL("../../home.history/plugin.ts", import.meta.url));
  let reads = 0;
  const source = {
    fire: () => Promise.resolve(),
    modules: { linked: () => [{ plugin: { homeProvider: {
      name: "meter", history: () => { reads++; return Promise.resolve([sample(0, 10), sample(60, 12)]); },
    } } }] },
  } as unknown as App;
  const node = { app, settings: { provider: () => "meter", entity: () => "meter", source: () => "provider", consumption: () => true, maxGap: () => 180, hours: () => 24 } } as unknown as Node;
  try {
    await app.init();
    app.t = fakeT;
    const guest = await testContext({ app: source });
    await requestStorage.run(guest, async () => {
      assertStringIncludes(String(await cms.node.render(node)), "Access denied");
      assertEquals(reads, 0);
    });
    const user = await testContext({ app: source, set: { user: { id: 7 } } });
    await requestStorage.run(user, async () => {
      const output = String(await cms.node.parts.plot(node, { vars: { start: new Date(start).toISOString(), end: new Date(start + 600_000).toISOString() } }));
      assertStringIncludes(output, "Counter consumption per observation interval");
      assertStringIncludes(output, "<td>2</td>");
      assertEquals(reads, 1);
      assertStringIncludes(String(await cms.node.parts.plot(node, { vars: { start: "bad", end: "bad" } })), "timezone");
    });
  } finally { await app.db.close(); await Deno.remove(dir, { recursive: true }); }
});
