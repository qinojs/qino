import { assertEquals } from "../../core/tests/deps.ts";
import { backendDashboardWidget, cms, name, needs } from "../plugin.ts";

Deno.test("cms.backend.users: metadata and cms export are wired", () => {
  assertEquals(name, "cms.backend.users");
  assertEquals(needs, ["cms.backend"]);
  assertEquals(cms.node.css, ["pub/main.css"]);
  assertEquals(typeof cms.node.api, "function");
  assertEquals(typeof cms.node.parts.list, "function");
});

Deno.test("cms.backend.users: dashboard widget renders counts and recent logins", async () => {
  const oneValues = [7, 5];
  const app = {
    db: {
      one: async () => oneValues.shift(),
      all: async () => [{ email: "user@example.test", access: 1700000000 }],
    },
  } as unknown as Parameters<typeof backendDashboardWidget>[0];
  const out = await backendDashboardWidget(app);
  assertEquals(out.includes("Gesamt:<td>7"), true);
  assertEquals(out.includes("Aktiv:<td>5"), true);
  assertEquals(out.includes("user@example.test"), true);
  assertEquals(out.includes("2023-11-14T22:13:20.000Z"), true);
});
