// deno-lint-ignore-file no-explicit-any
import { assertStringIncludes } from "../../core/tests/deps.ts";
import { requestStorage } from "../../core/mod.ts";
import { cms } from "../plugin.ts";

const t = (strings: TemplateStringsArray, ...values: unknown[]) =>
  strings.reduce((out, string, i) => out + string + (i < values.length ? String(values[i] ?? "") : ""), "");

function fixture(query = {}) {
  const demo = {
    name: "demo.module",
    source: "https://modules.example/demo.module/plugin.ts",
    modUrl: "https://modules.example/demo.module/",
    description: "Demo description",
    dependencies: ["core"],
    manifest: { description: "Demo description", dependencies: ["core"] },
    plugin: { init() {}, api: { things: { get() {} } } },
  };
  const modules = { "demo.module": demo };
  const app = {
    t,
    modules: {
      all: () => modules,
      get: (name: string) => modules[name as keyof typeof modules],
      linked: () => true,
      declared: () => false,
      failures: () => ({}),
    },
    stores: { all: () => [] },
    db: { query: () => Promise.resolve([]) },
  };
  const ctx = {
    req: { query, url: { toURL: () => new URL("http://test/backend/superuser/module") } },
    user: { superuser: true },
    state: {},
  };
  return { node: { app, vs: { module: "cms.backend.superuser.module" } }, ctx };
}

Deno.test("module administration combines stores and module metadata", async () => {
  const { node, ctx } = fixture();
  const out = await requestStorage.run(ctx as any, () => cms.node.render(node as any).then(String));
  assertStringIncludes(out, "Module stores");
  assertStringIncludes(out, "demo.module");
  assertStringIncludes(out, "Demo description");
  assertStringIncludes(out, "dependencies");
  if (out.includes("Exports")) throw new Error("Exports belong on the detail page only");
});

Deno.test("module administration keeps the module detail view", async () => {
  const { node, ctx } = fixture({ mod: "demo.module" });
  const out = await requestStorage.run(ctx as any, () => cms.node.render(node as any).then(String));
  assertStringIncludes(out, "Demo description");
  assertStringIncludes(out, "Exports");
  assertStringIncludes(out, "API routes");
  assertStringIncludes(out, "Remote module");
});
