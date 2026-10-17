// deno-lint-ignore-file no-explicit-any
import { requestStorage } from "@qino/qino";
import { assertEquals, testContext } from "@qino/qino/tests";

import { cms } from "../plugin.ts";

function settings(values: Record<string, unknown> = {}) {
  return new Proxy({}, {
    get(_target, prop: string) {
      return () => values[prop] ?? "";
    },
  });
}

async function makeCtx(loggedIn = false) {
  const ctx = await testContext({
    sess: { data: { core: { userId: () => loggedIn ? 7 : 0, csrfToken: () => "tok" } } },
    app: {
      db: {
        table: (name: string) => ({
          row: () => name === "usr" ? { superuser: false, email: "user@example.test" } : null,
        }),
      },
    },
  });
  ctx.clientId = "client-1";
  return ctx;
}

Deno.test("cms.cont.logout: render shows logout form for logged-in users", async () => {
  const ctx = await makeCtx(true);
  const node = {
    edit: () => false,
    app: { t: (_strings: TemplateStringsArray) => Promise.resolve("Abmelden") },
    cms: {},
    settings: settings({}),
  };

  const out = String(await requestStorage.run(ctx, () => cms.node.render(node as any, { ctx })));
  assertEquals(out.includes("<button name=core_logout>Abmelden</button>"), true);
  assertEquals(out.includes('name=csrfToken value="tok"'), true);
});

Deno.test("cms.cont.logout: escapes the logout token", async () => {
  const userCtx = await makeCtx(true);
  userCtx.sess = { data: { core: { userId: () => 7, csrfToken: () => `t"><script>x</script>` } } } as any;
  const userNode = {
    edit: () => false,
    app: { t: (_strings: TemplateStringsArray) => Promise.resolve("Abmelden") },
    cms: {},
    settings: settings({}),
  };

  const logout = String(await requestStorage.run(userCtx, () => cms.node.render(userNode as any, { ctx: userCtx })));
  assertEquals(logout.includes(`t&quot;&gt;&lt;script&gt;x&lt;/script&gt;`), true);
  assertEquals(logout.includes("<script>"), false);
});

Deno.test("cms.cont.logout: guests see no logout form", async () => {
  const ctx = await makeCtx(false);
  const node = { edit: () => false };
  const out = String(await requestStorage.run(ctx, () => cms.node.render(node as any, { ctx })));
  assertEquals(out, "");
});
