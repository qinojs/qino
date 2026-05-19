// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "../../core/tests/deps.ts";
import { cms, name, needs } from "../mod.ts";

Deno.test("cms.backend.superuser: metadata is wired", () => {
  assertEquals(name, "cms.backend.superuser");
  assertEquals(needs, ["cms.backend"]);
});

Deno.test("cms.backend.superuser: render handles empty child list", async () => {
  const page = { children: () => new Map() };
  const node = { page: () => page };
  assertEquals(await cms.node.render(node as any), "<div></div>");
});

Deno.test("cms.backend.superuser: render links child modules", async () => {
  const child = {
    url: () => `/backend/superuser?q="><script>x</script>`,
    title: () => ({ string: () => `DB"><script>x</script>` }),
  };
  const page = {
    title: () => ({ string: () => "Superuser" }),
    children: () => new Map([[1, child]]),
  };
  const node = { page: () => page };
  const out = await cms.node.render(node as any);
  assertEquals(out.includes(`href="/backend/superuser?q=&quot;&gt;&lt;script&gt;x&lt;/script&gt;"`), true);
  assertEquals(out.includes(`DB&quot;&gt;&lt;script&gt;x&lt;/script&gt;`), true);
  assertEquals(out.includes("<script>"), false);
});
