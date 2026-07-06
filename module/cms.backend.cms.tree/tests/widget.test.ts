import { assertEquals } from "../../core/tests/deps.ts";
import { backendDashboardWidget, cms, name, needs } from "../plugin.ts";

Deno.test("cms.backend.struct: metadata and cms export are wired", () => {
  assertEquals(name, "cms.backend.cms.tree");
  assertEquals(needs, ["cms.backend"]);
  assertEquals(cms.node.css, ["pub/main.css"]);
  assertEquals(typeof cms.node.parts.list, "function");
});

Deno.test("cms.backend.struct: dashboard widget renders page counters", async () => {
  const values = [20, 3, 5];
  const app = { db: { one: async () => values.shift() }, t: (s: TemplateStringsArray) => s.join("") } as unknown as Parameters<typeof backendDashboardWidget>[0];
  const out = await backendDashboardWidget(app);
  assertEquals(out.includes("Pages total:<td>20"), true);
  assertEquals(out.includes("Offline:<td>3"), true);
  assertEquals(out.includes("Hidden:<td>5"), true);
});
