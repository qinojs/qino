// deno-lint-ignore-file no-explicit-any
import { html, requestStorage } from "@qino/qino";
import { assertEquals, assertStringIncludes, testContext } from "@qino/qino/tests";

import { cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };

const { name, dependencies } = manifest;

const child = (id: number) => ({ id, html: () => Promise.resolve(html.raw(`<div qcms-id=${id}>entry</div>`)) });

/** Node fake: the children, the settings, and whether `cont()` was asked to create one. */
function listNode(opts: { edit?: boolean; children?: number; settings?: Record<string, unknown> } = {}) {
  const created: Array<[string, any]> = [];
  let conts = Array.from({ length: opts.children ?? 0 }, (_, i) => child(i + 1));
  const settings = opts.settings ?? {};
  const properties = cms.node.settingsSchema.properties as Record<string, { default?: unknown }>;
  return {
    id: 5,
    edit: !!opts.edit,
    conts: () => Promise.resolve(conts),
    cont: (name: string, attrs: any) => {
      created.push([name, attrs]);
      conts = [child(99)];
      return Promise.resolve(child(99));
    },
    settings: new Proxy({}, { get: (_t, key: string) => () => settings[key] ?? properties[key]?.default }),
    created,
  } as any;
}

const run = (node: any, ctx: any) => requestStorage.run(ctx, () => cms.node.render(node as never)).then(String);

Deno.test("cms.cont.items: metadata is wired", () => {
  assertEquals(name, "cms.cont.items");
  assertEquals(dependencies, ["cms"]);
  assertEquals(cms.node.widget, "pub/options.js");
  assertEquals(cms.node.settingsSchema.properties["default module"].default, "cms.cont.flexible");
});

Deno.test("cms.cont.items: the entries sit in a u2 grid", async () => {
  const ctx = await testContext();
  const out = await run(listNode({ children: 2 }), ctx);
  assertEquals(out.startsWith('<div class="u2-grid">'), true, out);
  assertStringIncludes(out, "<div qcms-id=1>entry</div><div qcms-id=2>entry</div>");
});

Deno.test("cms.cont.items: an empty list gets its first entry — for the editor only", async () => {
  const ctx = await testContext();
  const editor = listNode({ edit: true });
  assertStringIncludes(await run(editor, ctx), "<div qcms-id=99>entry</div>");
  assertEquals(editor.created, [["first", { module: "cms.cont.flexible" }]]);

  // A visitor's page view must not write to the database.
  const visitor = listNode({});
  assertStringIncludes(await run(visitor, ctx), '<div class="u2-grid"></div>');
  assertEquals(visitor.created, []);
});

Deno.test("cms.cont.items: the first entry uses the module the block was set to", async () => {
  const ctx = await testContext();
  const node = listNode({ edit: true, settings: { "default module": "cms.cont.html" } });
  await run(node, ctx);
  assertEquals(node.created, [["first", { module: "cms.cont.html" }]]);
});

Deno.test("cms.cont.items: the add position is a setting, so both list shapes are possible", () => {
  const pos = cms.node.settingsSchema.properties["add position"];
  assertEquals(pos.default, "bottom");
  assertEquals(pos.enum, ["bottom", "top"]);
});
