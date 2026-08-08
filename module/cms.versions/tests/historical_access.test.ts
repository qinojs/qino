// deno-lint-ignore-file no-explicit-any
import { assertEquals, Emitter, testContext } from "../../core/tests/deps.ts";
import { requestStorage } from "../../core/mod.ts";
import { cmsInstances } from "../../cms/lib/CMS.ts";
import { render } from "../../cms/lib/render.ts";
import { cacheHeaders, getCmsVers, initHistoricalNodes } from "../lib/CmsVers.ts";

function setup(current: Record<number, any>, access: Record<number, number>, historical: Record<number, any> = {}) {
  const emitter = new Emitter<any>();
  const calls: number[] = [];
  const db = {
    row: (...args: any[]) => {
      const id = Number(args.find((v) => typeof v === "number"));
      return Promise.resolve(args[0].join("?").includes("FROM page ") ? current[id] : historical[id]);
    },
    query: (...args: any[]) => {
      const basis = Number(args.find((v) => typeof v === "number"));
      return Promise.resolve(Object.values(current).filter((row: any) => row.basis === basis));
    },
  };
  const app = {
    db,
    languages: { all: ["en"] },
    on: emitter.on.bind(emitter),
    fire: emitter.fire.bind(emitter),
  };

  const make = (row: any) => ({
    id: row.id,
    vs: row,
    access: () => Promise.resolve(access[row.id] ?? 0),
    files: () => { calls.push(row.id); return Promise.resolve({}); },
    title: () => Promise.resolve(""),
    urlSeo: () => Promise.resolve(""),
    texts: () => Promise.resolve({}),
  });

  const ctxPromise = testContext({ app });
  initHistoricalNodes(app as any, new AbortController().signal);
  return ctxPromise.then((ctx) => {
    ctx.state.dbScope = { tables: { page: "history" }, cache: {} };
    getCmsVers(ctx).log = 1;
    return { app, calls, ctx, make };
  });
}

async function construct(state: Awaited<ReturnType<typeof setup>>, row: any) {
  const node = state.make(row);
  await requestStorage.run(state.ctx, () => state.app.fire("node:construct", { node }));
  return node;
}

async function children(state: Awaited<ReturnType<typeof setup>>, parent: number, historical: any[]) {
  const e = { node: { id: parent }, rows: historical };
  await requestStorage.run(state.ctx, () => state.app.fire("node:children", e));
  const nodes = new Map<number, any>();
  for (const row of e.rows) {
    if (nodes.has(row.id)) continue;
    const node = await construct(state, row);
    if (!Object.keys(node.vs).length || node.vs.basis !== parent) continue;
    nodes.set(row.id, node);
  }
  return nodes;
}

Deno.test("cms.versions: current access selects current or historical data", async () => {
  const current = { id: 1, basis: 0, version: "current" };
  const historical = { id: 1, basis: 0, version: "historical" };

  const guest = await setup({ 1: current }, { 1: 1 }, { 1: historical });
  assertEquals((await construct(guest, historical)).vs, current);
  assertEquals(guest.calls, []);

  const editor = await setup({ 1: current }, { 1: 2 }, { 1: historical });
  const node = await construct(editor, historical);
  assertEquals(node.vs.version, "historical");
  assertEquals(node.vs.online_start, 0);
  assertEquals(editor.calls, [1]);
});

Deno.test("cms.versions: current-only and deleted nodes follow current access", async () => {
  const current = { id: 2, basis: 1, version: "current" };
  const historical = { id: 3, basis: 1, version: "historical" };

  const guest = await setup({ 2: current }, { 2: 1, 3: 1 }, { 3: historical });
  assertEquals([...await children(guest, 1, [historical])].map(([id]) => id), [2]);

  const editor = await setup({ 2: current }, { 2: 2, 3: 2 }, { 3: historical });
  assertEquals([...await children(editor, 1, [historical])].map(([id]) => id), [3]);
});

Deno.test("cms.versions: moved content follows the selected version's position", async () => {
  const current = { id: 4, basis: 2, version: "current" };
  const historical = { id: 4, basis: 1, version: "historical" };
  const setupData = await setup({ 4: current }, { 4: 1 }, { 4: historical });

  assertEquals((await children(setupData, 1, [historical])).size, 0);
  assertEquals([...await children(setupData, 2, [])].map(([id]) => id), [4]);

  const editor = await setup({ 4: current }, { 4: 2 }, { 4: historical });
  assertEquals((await children(editor, 2, [])).size, 0);
  assertEquals([...await children(editor, 1, [historical])].map(([, node]) => node.vs.version), ["historical"]);
});

Deno.test("cms.versions: historical responses stay privately cacheable", async () => {
  const ctx = await testContext({ app: { fire: () => {}, settings: { cms: {} } } });
  const page = {
    vs: { searchable: 1 }, exists: () => true, access: () => 1, isReadable: () => true,
    page: () => page, text: () => null, title: () => null, html: () => "",
  };
  cmsInstances.set(ctx.app, { nodeFromRequest: () => page } as any);
  cacheHeaders(ctx);
  await render(ctx);
  assertEquals(ctx.res.headers.get("Cache-Control"), "private, max-age=15552000");
});
