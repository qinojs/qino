// deno-lint-ignore-file no-explicit-any
import { assertEquals, testContext } from "../../core/tests/deps.ts";
import { cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };
const { name } = manifest;
import { requestStorage } from "../../core/mod.ts";

function settings(values: Record<string, unknown> = {}) {
  return new Proxy({}, {
    get(_target, prop: string) {
      return () => values[prop] ?? "";
    },
  });
}

function textObj(value = "") {
  return {
    string: () => value,
    lang: () => ({ set: () => {} }),
  };
}

async function makeCtx(loggedIn = false) {
  const ctx = await testContext({
    sess: { data: { core: { userId: () => loggedIn ? 7 : 0, csrfToken: () => "tok" } } },
    app: {
      db: {
        table: (name: string) => ({
          entry: () => name === "usr" ? { get: (key: string) => key === "superuser" ? false : "user@example.test" } : null,
        }),
      },
    },
  });
  ctx.clientId = "client-1";
  return ctx;
}

Deno.test("cms.cont.login4: metadata is wired", () => {
  assertEquals(name, "cms.cont.login4");
  assertEquals(cms.node.settingsSchema.properties.saveLogin.type, "boolean");
});

Deno.test("cms.cont.login4: render shows login form for guests", async () => {
  const ctx = await makeCtx(false);
  const node = {
    edit: false,
    app: { t: (_strings: TemplateStringsArray) => "Anmelden" },
    cms: {
      text: (_node: unknown, name: string) => `[${name}]`,
    },
    settings: settings({ saveLogin: true }),
    text: () => textObj("Login failed"),
  };

  const out = String(await requestStorage.run(ctx, () => cms.node.render(node as any, { ctx })));
  assertEquals(out.includes("<form method=post>"), true);
  assertEquals(out.includes("<input name=email type=text required autofocus>"), true);
  assertEquals(out.includes('name=csrfToken value="tok"'), true);
  assertEquals(out.includes("<input name=save_login type=checkbox value=1 class=c1-fakable>"), true);
  assertEquals(out.includes("[user]"), true);
  assertEquals(out.includes("[pw]"), true);
});

Deno.test("cms.cont.login4: render redirects logged-in users when configured", async () => {
  const ctx = await makeCtx(true);
  const node = {
    edit: false,
    app: { t: (_strings: TemplateStringsArray) => "x" },
    cms: {
      node: () => ({ exists() { return this; }, url: () => "/target" }),
    },
    settings: settings({ redirect: 42 }),
    text: () => textObj(""),
  };

  const out = String(await requestStorage.run(ctx, () => cms.node.render(node as any, { ctx })));
  assertEquals(out, "");
  assertEquals(ctx.res.status, 302);
  assertEquals(ctx.res.headers.get("Location"), "/target");
});

Deno.test("cms.cont.login4: render shows logout form for logged-in users", async () => {
  const ctx = await makeCtx(true);
  const node = {
    edit: false,
    app: { t: (_strings: TemplateStringsArray) => "Abmelden" },
    cms: {},
    settings: settings({}),
    text: () => textObj(""),
  };

  const out = String(await requestStorage.run(ctx, () => cms.node.render(node as any, { ctx })));
  assertEquals(out.includes("<button name=core_logout>Abmelden</button>"), true);
  assertEquals(out.includes('name=csrfToken value="tok"'), true);
});

Deno.test("cms.cont.login4: render escapes fixed users and logout tokens", async () => {
  const guestCtx = await makeCtx(false);
  const guestNode = {
    edit: false,
    app: { t: (_strings: TemplateStringsArray) => "Anmelden" },
    cms: { text: (_node: unknown, name: string) => `[${name}]` },
    settings: settings({ "fix user": `a"><script>alert(1)</script>` }),
    text: () => textObj(""),
  };

  const login = String(await requestStorage.run(guestCtx, () => cms.node.render(guestNode as any, { ctx: guestCtx })));
  assertEquals(login.includes(`a&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;`), true);
  assertEquals(login.includes("<script>"), false);

  const userCtx = await makeCtx(true);
  userCtx.sess = { data: { core: { userId: () => 7, csrfToken: () => `t"><script>x</script>` } } } as any;
  const userNode = {
    edit: false,
    app: { t: (_strings: TemplateStringsArray) => "Abmelden" },
    cms: {},
    settings: settings({}),
    text: () => textObj(""),
  };

  const logout = String(await requestStorage.run(userCtx, () => cms.node.render(userNode as any, { ctx: userCtx })));
  assertEquals(logout.includes(`t&quot;&gt;&lt;script&gt;x&lt;/script&gt;`), true);
  assertEquals(logout.includes("<script>"), false);
});
