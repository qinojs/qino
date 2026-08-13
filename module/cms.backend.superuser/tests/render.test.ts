// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "@qino/qino/tests";

import { cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };

const { name, dependencies } = manifest;

Deno.test("cms.backend.superuser: metadata is wired", () => {
  assertEquals(name, "cms.backend.superuser");
  assertEquals(dependencies, ["cms.backend"]);
});

Deno.test("cms.backend.superuser: render handles empty child list", async () => {
  const page = { children: () => new Map() };
  const node = { page: () => page };
  const out = String(await cms.node.render(node as any));
  assertEquals(out.includes("No widgets available"), true);
});

Deno.test("cms.backend.superuser: render links child modules", async () => {
  const child = {
    vs: { visible: 1 },
    access: () => 1,
    conts: () => [{ module: { plugin: { backendDashboardWidget: () => "<p>DB stats</p>" } } }],
    url: () => `/backend/superuser?q="><script>x</script>`,
    title: () => ({ string: () => `DB"><script>x</script>` }),
  };
  const page = { children: () => new Map([[1, child]]) };
  const node = { page: () => page, app: {} };
  const out = String(await cms.node.render(node as any));
  assertEquals(out.includes(`href="/backend/superuser?q=&quot;&gt;&lt;script&gt;x&lt;/script&gt;"`), true);
  assertEquals(out.includes(`DB&quot;&gt;&lt;script&gt;x&lt;/script&gt;`), true);
  assertEquals(out.includes("<p>DB stats</p>"), true);
  assertEquals(out.includes("<script>"), false);
});
