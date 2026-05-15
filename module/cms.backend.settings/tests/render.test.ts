import { assertEquals } from "../../../deps.ts";
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
  assertEquals(out.includes("source=\"{&quot;kind&quot;:&quot;app&quot;,&quot;path&quot;:[]}\""), true);
  assertEquals(ctx.html.jsms["/m/core/pub/js/SettingsEditor.mjs"], true);
  assertEquals(ctx.csp["script-src"]["https://cdn.jsdelivr.net"], 1);
});

Deno.test("cms.backend.settings: dashboard widget escapes count", async () => {
  const out = await backendDashboardWidget({ db: { one: () => 12 } });
  assertEquals(out.includes("<tr><td>Einträge:<td>12"), true);
});
