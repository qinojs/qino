// deno-lint-ignore-file no-explicit-any
import { test } from "node:test";
import { assertEquals } from "@qino/qino/tests";

import { backendDashboardWidget, cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };

const { name, dependencies } = manifest;

test("cms.backend.superuser: metadata is wired", () => {
  assertEquals(name, "cms.backend.superuser");
  assertEquals(dependencies, ["cms.backend"]);
});

test("cms.backend.superuser: render handles empty child list", async () => {
  const page = { children: () => new Map() };
  const node = { page: () => page };
  const out = String(await cms.node.render(node as any));
  assertEquals(out.includes("No widgets available"), true);
});

test("cms.backend.superuser: render links child modules", async () => {
  const child = {
    vs: { visible: 1 },
    access: () => 1,
    conts: () => [{ module: { plugin: { backendDashboardWidget: () => "<p>DB stats</p>" } } }],
    url: () => Promise.resolve(`/backend/superuser?q="><script>x</script>`),
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

test("cms.backend.superuser: its dashboard widget says what is new, per sub-page that is there", async () => {
  const pages: Record<string, unknown> = {
    "cms.backend.superuser.messaging": { access: () => 1, url: () => Promise.resolve("/backend/superuser/messaging#cmspid5") },
    "cms.backend.superuser.error_report": { access: () => 0, url: () => Promise.resolve("/backend/superuser/errors") },
  };
  const page = { cms: { nodeByModule: (module: string) => pages[module] && { page: () => pages[module] } } };
  const app = {
    db: { one: () => Promise.resolve(5) },
    t: Object.assign((s: TemplateStringsArray) => Promise.resolve(s.join("")), { with: (_ns: string, fn: () => unknown) => fn() }),
  };
  const out = String(await backendDashboardWidget(app as any, page as any));
  assertEquals(out.includes(`<td>5<td><a href="/backend/superuser/messaging">new messages</a>`), true);
  assertEquals(out.includes("new errors"), false); // a page the user may not see
  assertEquals(out.includes("clients"), false); // a page that is not there
});
