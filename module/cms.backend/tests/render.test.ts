// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "@qino/qino/tests";

import { renderRowWidgets } from "../lib/dashboard.ts";
import { cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };

const { name, dependencies } = manifest;

Deno.test("cms.backend: metadata is wired", () => {
  assertEquals(name, "cms.backend");
  assertEquals(dependencies, ["cms", "u2"]);
});

Deno.test("cms.backend: render shows fallback when no dashboard widgets exist", async () => {
  const page = { children: () => new Map() };
  const node = { page: () => page };
  const out = String(await cms.node.render(node as any));
  assertEquals(out.includes("No widgets available."), true);
});

Deno.test("cms.backend: render collects visible child widgets", async () => {
  const child = {
    vs: { visible: 1 },
    access: () => 1,
    url: () => Promise.resolve("/backend/settings"),
    title: () => ({ string: () => "Settings" }),
    conts: () => [{
      module: { plugin: { backendDashboardWidget: () => "<table><tr><td>OK</table>" } },
    }],
  };
  const page = { children: () => new Map([[1, child]]) };
  const node = { page: () => page, app: {} };
  const out = String(await cms.node.render(node as any));
  assertEquals(out.includes('href="/backend/settings"'), true);
  assertEquals(out.includes(">Settings</a>"), true);
  assertEquals(out.includes("<table><tr><td>OK</table>"), true);
});

Deno.test("cms.backend: render escapes child links and titles", async () => {
  const child = {
    vs: { visible: 1 },
    access: () => 1,
    url: () => Promise.resolve(`/backend?q="><script>x</script>`),
    title: () => ({ string: () => `Settings"><script>x</script>` }),
    conts: () => [{
      module: { plugin: { backendDashboardWidget: () => "OK" } },
    }],
  };
  const page = { children: () => new Map([[1, child]]) };
  const node = { page: () => page, app: {} };
  const out = String(await cms.node.render(node as any));
  assertEquals(out.includes(`href="/backend?q=&quot;&gt;&lt;script&gt;x&lt;/script&gt;"`), true);
  assertEquals(out.includes(`Settings&quot;&gt;&lt;script&gt;x&lt;/script&gt;`), true);
  assertEquals(out.includes("<script>"), false);
});

Deno.test("cms.backend: row widgets come from modules whose backend page the viewer may see", async () => {
  const page = (url: string, access: boolean) => ({
    access: () => access,
    url: () => Promise.resolve(url),
    title: () => ({ string: () => url.slice(1) }),
  });
  const pages: Record<string, ReturnType<typeof page>> = { "x.invoices": page("/invoices", true), "x.secret": page("/secret", false) };
  const calls: unknown[] = [];
  const mod = (name: string, backendRowWidget: unknown) => ({ name, plugin: { backendRowWidget } });
  const app = {
    modules: {
      linked: () => [
        mod("x.invoices", { usr: (_app: unknown, id: unknown) => (calls.push(id), `<b>3 open</b> of ${id}`), grp: () => "nope" }),
        mod("x.secret", { usr: () => "<b>hidden</b>" }),
        mod("x.empty", { usr: () => "" }),
        mod("x.nopage", { usr: () => "<b>no page</b>" }),
        mod("x.none", undefined),
      ],
    },
  };
  const node = { app, vs: { module: "x.empty" }, cms: { nodeByModule: (name: string) => pages[name] && { page: () => pages[name] } } };
  const out = String(await renderRowWidgets(node as any, "usr", 7));
  assertEquals(out, `<div class=u2-card><a class=-head href="/invoices">invoices</a><b>3 open</b> of 7</div>`);
  assertEquals(calls, [7]); // the hidden module's widget is not even called
  assertEquals(String(await renderRowWidgets(node as any, "shop_product", 7)), "");
  // a widget may name its card where the page's name does not fit the one row
  const titled = { ...app, modules: { linked: () => [mod("x.invoices", { usr: () => ({ title: "Login <1>", body: "<b>eva</b>" }) })] } };
  assertEquals(String(await renderRowWidgets({ ...node, app: titled } as any, "usr", 7)),
    `<div class=u2-card><a class=-head href="/invoices">Login &lt;1&gt;</a><b>eva</b></div>`);
  // the page's own module adds no card: the page shows the row in full
  const own = { ...node, vs: { module: "x.invoices" } };
  assertEquals(String(await renderRowWidgets(own as any, "usr", 7)), "");
});
