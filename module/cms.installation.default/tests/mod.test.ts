import { assertEquals } from "../../core/tests/deps.ts";
import { name, needs } from "../mod.ts";

Deno.test("cms.installation.default: metadata lists required base modules", () => {
  assertEquals(name, "cms.installation.default");
  for (const mod of [
    "cms",
    "cms.frontend.1",
    "cms.backend",
    "error_report",
    "cms.versions",
    "cms.cont.flexible",
    "cms.cont.login4",
    "cms.layout.backend",
    "cms.layout.login",
    "cms.image2",
  ]) {
    assertEquals(needs.includes(mod), true, mod);
  }
  assertEquals(new Set(needs).size, needs.length);
});
