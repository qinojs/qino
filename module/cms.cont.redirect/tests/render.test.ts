// deno-lint-ignore-file no-explicit-any
import { requestStorage } from "@qino/qino";
import { assertEquals, assertStringIncludes, fakeT, testContext } from "@qino/qino/tests";

import { cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };

const { name, dependencies } = manifest;

function page(id: number, url: string, title = "Target") {
  return { id, exists: () => true, url: () => url, showTitle: () => title, isReadable: () => true };
}

/** Node fake: `value` is the stored `_redirect` text, `children` the pages below its page. */
function contNode(value: string, opt: { edit?: boolean; permanent?: boolean; parent?: any; children?: any[] } = {}) {
  const saved: string[] = [];
  const urlCalls: string[] = [];
  const node: any = {
    id: 9,
    edit: !!opt.edit,
    app: { t: fakeT },
    settings: { permanent: () => !!opt.permanent },
    texts: () => new Map([["_redirect", { string: () => value }]]),
    text: (_name: string, _lang: string, v: string) => { saved.push(v); },
    page: () => ({
      parent: () => opt.parent,
      children: () => new Map((opt.children ?? []).map((c) => [c.id, c])),
    }),
    cms: {
      formFields: () => "[fields]",
      url: (v: string, ret: any) => {
        urlCalls.push(v);
        if (/^\d+$/.test(v)) { ret.node = page(Number(v), "/target"); return "/target"; }
        return /^https?:/.test(v) ? v : undefined;
      },
    },
    saved,
    urlCalls,
  };
  return node;
}

/** `vars` reaches render the way an api caller's would — the module must ignore them. */
const run = (node: any, ctx: any, vars: any = {}) => {
  const args = { ctx, vars };
  return requestStorage.run(ctx, () => cms.node.render(node as never, args));
};

Deno.test("cms.cont.redirect: metadata is wired", () => {
  assertEquals(name, "cms.cont.redirect");
  assertEquals(dependencies, ["cms"]);
  assertEquals(cms.node.settingsSchema.properties.permanent.type, "boolean");
});

Deno.test("cms.cont.redirect: node id becomes a temporary redirect", async () => {
  const ctx = await testContext();
  assertEquals(String(await run(contNode("5"), ctx)), "");
  assertEquals(ctx.res.headers.get("Location"), "/target");
  assertEquals(ctx.res.status, 302);
});

Deno.test("cms.cont.redirect: permanent setting answers 301", async () => {
  const ctx = await testContext();
  await run(contNode("5", { permanent: true }), ctx);
  assertEquals(ctx.res.status, 301);
});

Deno.test("cms.cont.redirect: external url is kept as is", async () => {
  const ctx = await testContext();
  await run(contNode("https://example.test/x"), ctx);
  assertEquals(ctx.res.headers.get("Location"), "https://example.test/x");
});

Deno.test("cms.cont.redirect: unresolvable target does not redirect", async () => {
  const ctx = await testContext();
  await run(contNode("javascript:alert(1)"), ctx);
  assertEquals(ctx.res.headers.get("Location"), null);
  assertEquals(ctx.res.status, 200);
});

Deno.test("cms.cont.redirect: target pointing at the current page is skipped", async () => {
  const ctx = await testContext({ url: "http://qino.test/target" });
  await run(contNode("5"), ctx);
  assertEquals(ctx.res.headers.get("Location"), null);
});

Deno.test("cms.cont.redirect: __parent__ follows the tree", async () => {
  const ctx = await testContext();
  await run(contNode("__parent__", { parent: page(3, "/up") }), ctx);
  assertEquals(ctx.res.headers.get("Location"), "/up");
});

Deno.test("cms.cont.redirect: __last-child__ takes the last readable page", async () => {
  const ctx = await testContext();
  const children = [page(11, "/a"), page(12, "/b"), { ...page(13, "/hidden"), isReadable: () => false }];
  await run(contNode("__last-child__", { children }), ctx);
  assertEquals(ctx.res.headers.get("Location"), "/b");
});

Deno.test("cms.cont.redirect: edit mode shows the target instead of redirecting", async () => {
  const ctx = await testContext();
  const out = String(await run(contNode("5", { edit: true }), ctx));
  assertEquals(ctx.res.headers.get("Location"), null);
  assertStringIncludes(out, '<option value="url" selected>');
  assertStringIncludes(out, '<a href="/target">Go to: Target</a>');
});

Deno.test("cms.cont.redirect: edit mode warns about a missing target", async () => {
  const ctx = await testContext();
  const out = String(await run(contNode("", { edit: true }), ctx));
  assertStringIncludes(out, "No target defined yet.");
});

/** A same-origin form post addressing node 9, as `cms.formFields()` builds it. */
function postCtx(fields: Record<string, string>, opt: { token?: string; origin?: string } = {}) {
  return testContext({
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: opt.origin ?? "http://qino.test" },
    body: new URLSearchParams({ "qcms-node": "9", csrfToken: opt.token ?? "tok", ...fields }).toString(),
    sess: { data: { core: { userId: () => 1, csrfToken: () => "tok" } } },
  });
}

Deno.test("cms.cont.redirect: posted form stores the target", async () => {
  const node = contNode("", { edit: true });
  await run(node, await postCtx({ save: "", mode: "url", target: " 7 " }));
  assertEquals(node.saved, ["7"]);
});

Deno.test("cms.cont.redirect: posted form stores a relative target", async () => {
  const node = contNode("", { edit: true });
  await run(node, await postCtx({ save: "", mode: "__parent__", target: "7" }));
  assertEquals(node.saved, ["__parent__"]);
});

Deno.test("cms.cont.redirect: post without a valid csrf token stores nothing", async () => {
  const node = contNode("", { edit: true });
  await run(node, await postCtx({ save: "", mode: "url", target: "7" }, { token: "wrong" }));
  assertEquals(node.saved, []);
});

Deno.test("cms.cont.redirect: cross-site post stores nothing", async () => {
  const node = contNode("", { edit: true });
  await run(node, await postCtx({ save: "", mode: "url", target: "7" }, { origin: "http://evil.test" }));
  assertEquals(node.saved, []);
});

Deno.test("cms.cont.redirect: api render vars cannot store a target", async () => {
  const ctx = await testContext();
  const node = contNode("", { edit: true });
  await run(node, ctx, { save: "", mode: "url", target: "7" });
  assertEquals(node.saved, []);
});

Deno.test("cms.cont.redirect: internal path skips the url whitelist, '//host' does not", async () => {
  const ctx = await testContext();
  const internal = contNode("/de/page");
  await run(internal, ctx);
  assertEquals(internal.urlCalls, []);
  assertEquals(ctx.res.headers.get("Location"), "/de/page");

  const relative = contNode("//evil.test/x");
  await run(relative, await testContext());
  assertEquals(relative.urlCalls, ["//evil.test/x"]); // an external target, checked like any other
});

Deno.test("cms.cont.redirect: target with a line break is refused", async () => {
  const ctx = await testContext();
  const node = contNode("/a\nSet-Cookie: x=1");
  await run(node, ctx);
  assertEquals(node.urlCalls, []);
  assertEquals(ctx.res.headers.get("Location"), null);
});

Deno.test("cms.cont.redirect: unparsable target does not break the render", async () => {
  const ctx = await testContext();
  const node = contNode("http://[");
  assertEquals(String(await run(node, ctx)), "");
  assertEquals(ctx.res.headers.get("Location"), null);
});
