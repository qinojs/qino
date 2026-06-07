// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "../../core/tests/deps.ts";
import { cms, name } from "../plugin.ts";
import { RequestContext, requestStorage } from "../../core/mod.ts";

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

function makeCtx(loggedIn = false) {
  const ctx = new RequestContext();
  ctx.session = { liveUser: () => loggedIn ? 7 : 0, qg: { token: () => "tok" } } as any;
  ctx.clientId = "client-1";
  ctx.app = {
    db: {
      table: (name: string) => ({
        Entry: () => name === "usr" ? { get: (key: string) => key === "superuser" ? false : "user@example.test" } : null,
      }),
    },
  } as any;
  ctx.state = {};
  return ctx;
}

Deno.test("cms.cont.login4: metadata is wired", () => {
  assertEquals(name, "cms.cont.login4");
  assertEquals(cms.node.settingsSchema.properties.saveLogin.type, "boolean");
});

Deno.test("cms.cont.login4: render shows login form for guests", async () => {
  const ctx = makeCtx(false);
  const node = {
    edit: false,
    app: { t: (_strings: TemplateStringsArray) => "Anmelden" },
    cms: {
      text: (_node: unknown, name: string) => `[${name}]`,
    },
    settings: settings({ saveLogin: true }),
    text: () => textObj("Login failed"),
  };

  const out = await requestStorage.run(ctx, () => cms.node.render(node as any));
  assertEquals(out.includes("<form method=post>"), true);
  assertEquals(out.includes("<input name=email type=text required autofocus>"), true);
  assertEquals(out.includes('name=token value="tok"'), true);
  assertEquals(out.includes("<input name=save_login type=checkbox value=1 class=c1-fakable>"), true);
  assertEquals(out.includes("[user]"), true);
  assertEquals(out.includes("[pw]"), true);
});

Deno.test("cms.cont.login4: render redirects logged-in users when configured", async () => {
  const ctx = makeCtx(true);
  const node = {
    edit: false,
    app: { t: (_strings: TemplateStringsArray) => "x" },
    cms: {
      node: () => ({ is: () => true, url: () => "/target" }),
    },
    settings: settings({ redirect: 42 }),
    text: () => textObj(""),
  };

  const out = await requestStorage.run(ctx, () => cms.node.render(node as any));
  assertEquals(out, "");
  assertEquals(ctx.responseStatus, 302);
  assertEquals(ctx.responseHeaders.get("Location"), "/target");
});

Deno.test("cms.cont.login4: render shows logout form for logged-in users", async () => {
  const ctx = makeCtx(true);
  const node = {
    edit: false,
    app: { t: (_strings: TemplateStringsArray) => "Abmelden" },
    cms: {},
    settings: settings({}),
    text: () => textObj(""),
  };

  const out = await requestStorage.run(ctx, () => cms.node.render(node as any));
  assertEquals(out.includes("<button name=liveUser_logout>Abmelden</button>"), true);
  assertEquals(out.includes('name=token value="tok"'), true);
});

Deno.test("cms.cont.login4: render escapes fixed users and logout tokens", async () => {
  const guestCtx = makeCtx(false);
  const guestNode = {
    edit: false,
    app: { t: (_strings: TemplateStringsArray) => "Anmelden" },
    cms: { text: (_node: unknown, name: string) => `[${name}]` },
    settings: settings({ "fix user": `a"><script>alert(1)</script>` }),
    text: () => textObj(""),
  };

  const login = await requestStorage.run(guestCtx, () => cms.node.render(guestNode as any));
  assertEquals(login.includes(`a&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;`), true);
  assertEquals(login.includes("<script>"), false);

  const userCtx = makeCtx(true);
  userCtx.session = { liveUser: () => 7, qg: { token: () => `t"><script>x</script>` } } as any;
  const userNode = {
    edit: false,
    app: { t: (_strings: TemplateStringsArray) => "Abmelden" },
    cms: {},
    settings: settings({}),
    text: () => textObj(""),
  };

  const logout = await requestStorage.run(userCtx, () => cms.node.render(userNode as any));
  assertEquals(logout.includes(`t&quot;&gt;&lt;script&gt;x&lt;/script&gt;`), true);
  assertEquals(logout.includes("<script>"), false);
});
