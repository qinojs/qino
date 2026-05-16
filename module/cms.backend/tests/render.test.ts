// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "../../core/tests/deps.ts";
import { cms, name, needs } from "../mod.ts";

Deno.test("cms.backend: metadata is wired", () => {
  assertEquals(name, "cms.backend");
  assertEquals(needs, ["cms"]);
});

Deno.test("cms.backend: render shows fallback when no dashboard widgets exist", async () => {
  const page = { children: () => new Map() };
  const node = { page: () => page };
  const out = await cms.node.render(node as any);
  assertEquals(out.includes("Keine Widgets verfügbar."), true);
});

Deno.test("cms.backend: render collects visible child widgets", async () => {
  const child = {
    vs: { visible: 1 },
    url: () => "/backend/settings",
    title: () => ({ string: () => "Settings" }),
    conts: () => [{
      module: { exports: { backendDashboardWidget: () => "<table><tr><td>OK</table>" } },
    }],
  };
  const page = { children: () => new Map([[1, child]]) };
  const node = { page: () => page, app: {} };
  const out = await cms.node.render(node as any);
  assertEquals(out.includes('href="/backend/settings"'), true);
  assertEquals(out.includes(">Settings</a>"), true);
  assertEquals(out.includes("<table><tr><td>OK</table>"), true);
});

Deno.test("cms.backend: render escapes child links and titles", async () => {
  const child = {
    vs: { visible: 1 },
    url: () => `/backend?q="><script>x</script>`,
    title: () => ({ string: () => `Settings"><script>x</script>` }),
    conts: () => [{
      module: { exports: { backendDashboardWidget: () => "OK" } },
    }],
  };
  const page = { children: () => new Map([[1, child]]) };
  const node = { page: () => page, app: {} };
  const out = await cms.node.render(node as any);
  assertEquals(out.includes(`href="/backend?q=&quot;&gt;&lt;script&gt;x&lt;/script&gt;"`), true);
  assertEquals(out.includes(`Settings&quot;&gt;&lt;script&gt;x&lt;/script&gt;`), true);
  assertEquals(out.includes("<script>"), false);
});
