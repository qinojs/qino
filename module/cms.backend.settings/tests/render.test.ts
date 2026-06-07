import { assertEquals } from "../../core/tests/deps.ts";
import { RequestContext } from "../../core/lib/RequestContext.ts";
import { backendDashboardWidget, cms, name, needs } from "../mod.ts";

Deno.test("cms.backend.settings: metadata is wired", () => {
  assertEquals(name, "cms.backend.settings");
  assertEquals(needs, ["cms.backend"]);
});

Deno.test("cms.backend.settings: render adds settings editor and app source", () => {
  const ctx = new RequestContext();
  ctx.sysURL = "/m/";
  const out = cms.node.render({}, { ctx });
  assertEquals(out.includes("<settings-editor"), true);
  assertEquals(out.includes("source=\"/api/core/settings\""), true);
  assertEquals(ctx.html.scripts.has("/m/core/pub/js/SettingsEditor.mjs"), true);
});

Deno.test("cms.backend.settings: dashboard widget escapes count", async () => {
  const app = { db: { one: async () => 12 } } as unknown as Parameters<typeof backendDashboardWidget>[0];
  const out = await backendDashboardWidget(app);
  assertEquals(out.includes("<tr><td>Entries:<td>12"), true);
});
