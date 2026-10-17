// deno-lint-ignore-file no-explicit-any
import { requestStorage } from "@qino/qino";
import { assertEquals, testContext } from "@qino/qino/tests";

import { cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };

const { name } = manifest;

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
          row: () => name === "usr" ? { superuser: false, email: "user@example.test" } : null,
        }),
      },
    },
  });
  ctx.clientId = "client-1";
  return ctx;
}

Deno.test("cms.cont.login.password: metadata is wired", () => {
  assertEquals(name, "cms.cont.login.password");
  assertEquals(cms.node.settingsSchema.properties.saveLogin.type, "boolean");
  assertEquals(cms.node.settingsSchema.properties.saveLogin.default, true);
});

Deno.test("cms.cont.login.password: render shows login form for guests", async () => {
  const ctx = await makeCtx(false);
  const node = {
    edit: () => false,
    app: { t: (_strings: TemplateStringsArray) => Promise.resolve("Anmelden") },
    cms: {
      text: (_node: unknown, name: string) => Promise.resolve(`[${name}]`),
    },
    settings: settings({ saveLogin: true }),
    text: () => textObj("Login failed"),
  };

  const out = String(await requestStorage.run(ctx, () => cms.node.render(node as any, { ctx })));
  assertEquals(out.includes("<form method=post>"), true);
  assertEquals(out.includes("<input name=email type=text required autofocus>"), true);
  assertEquals(out.includes('name=csrfToken value="tok"'), true);
  assertEquals(out.includes("<input name=save_login type=checkbox value=1>"), true);
  assertEquals(out.includes("[user]"), true);
  assertEquals(out.includes("[pw]"), true);
});

Deno.test("cms.cont.login.password: render redirects logged-in users when configured", async () => {
  const ctx = await makeCtx(true);
  const node = {
    edit: () => false,
    app: { t: (_strings: TemplateStringsArray) => Promise.resolve("x") },
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

Deno.test("cms.cont.login.password: render escapes fixed users", async () => {
  const guestCtx = await makeCtx(false);
  const guestNode = {
    edit: () => false,
    app: { t: (_strings: TemplateStringsArray) => Promise.resolve("Anmelden") },
    cms: { text: (_node: unknown, name: string) => Promise.resolve(`[${name}]`) },
    settings: settings({ "fix user": `a"><script>alert(1)</script>` }),
    text: () => textObj(""),
  };

  const login = String(await requestStorage.run(guestCtx, () => cms.node.render(guestNode as any, { ctx: guestCtx })));
  assertEquals(login.includes(`a&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;`), true);
  assertEquals(login.includes("<script>"), false);
});

Deno.test("cms.cont.login.password: signed-in users see no form without a redirect", async () => {
  const ctx = await makeCtx(true);
  const node = { edit: () => false, app: {}, cms: {}, settings: settings() };
  const out = String(await requestStorage.run(ctx, () => cms.node.render(node as any, { ctx })));
  assertEquals(out, "");
});
