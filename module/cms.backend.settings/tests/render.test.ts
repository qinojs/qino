import { assertEquals, testContext } from "@qino/qino/tests";
import { backendDashboardWidget, cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };
const { name, dependencies } = manifest;

Deno.test("cms.backend.settings: metadata is wired", () => {
  assertEquals(name, "cms.backend.settings");
  assertEquals(dependencies, ["cms.backend"]);
});

Deno.test("cms.backend.settings: render adds settings editor and app source", async () => {
  const ctx = await testContext();
  const out = String(cms.node.render({}, { ctx }));
  assertEquals(out.includes("<settings-editor"), true);
  assertEquals(out.includes("source=\"/api/core/settings\""), true);
  assertEquals(ctx.res.html.scripts.has("/m/core/pub/js/SettingsEditor.mjs"), true);
});

Deno.test("cms.backend.settings: dashboard widget escapes count", async () => {
  const app = { db: { one: () => 12 } } as unknown as Parameters<typeof backendDashboardWidget>[0];
  const out = String(await backendDashboardWidget(app));
  assertEquals(out.includes("<tr><td>Entries:<td>12"), true);
});
