// deno-lint-ignore-file no-explicit-any
import { assertEquals, fakeRender } from "@qino/qino/tests";
import { requestStorage } from "@qino/qino";
import { initNodeChanged } from "../lib/nodeChanged.ts";

// Minimal db fake: captures node_changed inserts, answers tree/link lookups.
function fakeApp(opts: { tree: Record<number, { type: string; basis: number }>; links?: Record<string, any[]> } = { tree: {} }) {
  const handlers: Record<string, (e: any) => any> = {};
  const inserts: Array<{ log: number; node: number; page: number; data: any }> = [];
  const links = opts.links ?? {};
  const db: any = {
    on: (name: string, fn: any) => (handlers[name] = fn),
    table: (name: string) => ({
      insert: (v: any) => {
        if (name === "node_changed") inserts.push({ log: Number(v.log_id), node: Number(v.node_id), page: Number(v.page_id), data: JSON.parse(String(v.data)) });
        return Promise.resolve("1");
      },
    }),
    row: (...a: any[]) => {
      const [text, params] = fakeRender(a[0], a.slice(1));
      if (text.includes("type, basis FROM page") || text.includes("basis FROM page")) {
        const row = opts.tree[Number(params[0])];
        return Promise.resolve(row ?? undefined);
      }
      return Promise.resolve(undefined);
    },
    query: (...a: any[]) => {
      const [text] = fakeRender(a[0], a.slice(1));
      // link lookups: keyed by the first template chunk
      for (const [key, rows] of Object.entries(links)) if (text.includes(key)) return Promise.resolve(rows);
      return Promise.resolve([]);
    },
  };
  const app: any = { db };
  return { app, handlers, inserts };
}

function fakeEvent(table: string, id: any, data: Record<string, any>) {
  return { table: { toString: () => table, entryIdValues: () => (typeof id === "object" ? id : { id }) }, id, data };
}

async function withCtx(fn: () => Promise<void>) {
  const ctx: any = { logId: Promise.resolve("42"), app: {} };
  await requestStorage.run(ctx, fn);
}

Deno.test("node_changed: page update captures one row for the page itself", async () => {
  const { app, handlers, inserts } = fakeApp({ tree: { 5: { type: "p", basis: 1 } } });
  initNodeChanged(app, new AbortController().signal);
  await withCtx(async () => {
    await handlers["table:update-after"](fakeEvent("page", 5, { visible: 1 }));
  });
  assertEquals(inserts.length, 1);
  assertEquals(inserts[0], { log: 42, node: 5, page: 5, data: { table: "page", op: "update", cols: ["visible"] } });
});

Deno.test("node_changed: page delete keeps node_id but anchors page_id at a surviving ancestor", async () => {
  const { app, handlers, inserts } = fakeApp({ tree: { 8: { type: "p", basis: 3 }, 3: { type: "p", basis: 1 } } });
  initNodeChanged(app, new AbortController().signal);
  await withCtx(async () => {
    await handlers["table:delete-before"](fakeEvent("page", 8, {}));
  });
  assertEquals(inserts.length, 1);
  // node = the deleted page itself; page = its parent (via basis), not 8 which is vanishing
  assertEquals(inserts[0], { log: 42, node: 8, page: 3, data: { table: "page", op: "delete" } });
});

Deno.test("node_changed: page_text insert links to its page", async () => {
  const { app, handlers, inserts } = fakeApp({ tree: { 7: { type: "c", basis: 3 }, 3: { type: "p", basis: 1 } } });
  initNodeChanged(app, new AbortController().signal);
  await withCtx(async () => {
    await handlers["table:insert-after"](fakeEvent("page_text", { page_id: 7, name: "main" }, { page_id: 7, name: "main", text_id: 99 }));
  });
  assertEquals(inserts.length, 1);
  assertEquals(inserts[0].node, 7);
  assertEquals(inserts[0].page, 3); // walked from content 7 up to page 3
  assertEquals(inserts[0].data.name, "main");
});

Deno.test("node_changed: text update resolves node via page_text + title link", async () => {
  const { app, handlers, inserts } = fakeApp({
    tree: { 7: { type: "c", basis: 3 }, 3: { type: "p", basis: 1 } },
    links: { "FROM page_text WHERE text_id": [{ page_id: 7 }] },
  });
  initNodeChanged(app, new AbortController().signal);
  await withCtx(async () => {
    await handlers["table:update-after"](fakeEvent("text", 99, { de: "hi" }));
  });
  assertEquals(inserts.length, 1);
  assertEquals(inserts[0].node, 7);
});

Deno.test("node_changed: text insert with no link yet produces no row", async () => {
  const { app, handlers, inserts } = fakeApp({ tree: {} }); // no page_text link
  initNodeChanged(app, new AbortController().signal);
  await withCtx(async () => {
    await handlers["table:insert-after"](fakeEvent("text", { id: 99, lang: "de" }, { id: 99, lang: "de", text: "hi" }));
  });
  assertEquals(inserts.length, 0);
});

Deno.test("node_changed: adding a new language to an existing text is tracked", async () => {
  const { app, handlers, inserts } = fakeApp({
    tree: { 7: { type: "c", basis: 3 }, 3: { type: "p", basis: 1 } },
    links: { "FROM page_text WHERE text_id": [{ page_id: 7 }] }, // text 99 already linked to node 7
  });
  initNodeChanged(app, new AbortController().signal);
  await withCtx(async () => {
    // set() inserts a new (id, lang) row when that language did not exist yet
    await handlers["table:insert-after"](fakeEvent("text", { id: 99, lang: "fr" }, { id: 99, lang: "fr", text: "salut" }));
  });
  assertEquals(inserts.length, 1);
  assertEquals(inserts[0].node, 7);
});

Deno.test("node_changed: unrelated table is ignored", async () => {
  const { app, handlers, inserts } = fakeApp({ tree: {} });
  initNodeChanged(app, new AbortController().signal);
  await withCtx(async () => {
    await handlers["table:insert-after"](fakeEvent("log", 1, { time: 1 }));
  });
  assertEquals(inserts.length, 0);
});

Deno.test("node_changed: no request context → no capture", async () => {
  const { app, handlers, inserts } = fakeApp({ tree: { 5: { type: "p", basis: 0 } } });
  initNodeChanged(app, new AbortController().signal);
  await handlers["table:update-after"](fakeEvent("page", 5, { visible: 1 })); // no requestStorage.run
  assertEquals(inserts.length, 0);
});
