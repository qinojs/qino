import { assertEquals } from "@qino/qino/tests";

import { backendDashboardWidget, cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };

const { name, dependencies } = manifest;

Deno.test("cms.backend.struct: metadata and cms export are wired", () => {
  assertEquals(name, "cms.backend.cms.tree");
  assertEquals(dependencies, ["cms.backend"]);
  assertEquals(cms.node.css, ["pub/main.css"]);
  assertEquals(typeof cms.node.parts.list, "function");
});

Deno.test("cms.backend.struct: dashboard widget renders page counters", async () => {
  const values = [20, 3, 5];
  const app = { db: { one: () => values.shift() }, t: (s: TemplateStringsArray) => s.join("") } as unknown as
    Parameters<typeof backendDashboardWidget>[0];
  const out = String(await backendDashboardWidget(app));
  assertEquals(out.includes("Pages total:<td>20"), true);
  assertEquals(out.includes("Offline:<td>3"), true);
  assertEquals(out.includes("Hidden:<td>5"), true);
});
