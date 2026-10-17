import { requestStorage } from "@qino/qino";
import { assertEquals, fakeCms } from "@qino/qino/tests";

import { api, init } from "../plugin.ts";

Deno.test("cms.frontend.ai.chat: in editmode, for signed-in users who may edit the page", async () => {
  let handler: (e: { ctx: unknown }) => Promise<void> = async () => {};
  const app = {};
  fakeCms(app, { on: (_: string, fn: typeof handler) => handler = fn });
  init(app as never, { signal: new AbortController().signal });
  const page = (userId: number, access: number, editmode = 1) => ({
    userId,
    req: { query: {}, moduleUrl: "/m/" },
    state: { cms: { mainNode: { id: 7, access: () => access }, editmode } },
    res: { html: { scripts: new Set<string>(), jsData: {} as any }, csp: { "script-src": {} as Record<string, boolean> } },
  });
  const run = async (ctx: ReturnType<typeof page>) => (await requestStorage.run(ctx as never, () => handler({ ctx })), ctx);
  assertEquals([...(await run(page(0, 3))).res.html.scripts], []);
  assertEquals([...(await run(page(5, 1))).res.html.scripts], []);
  assertEquals([...(await run(page(5, 3, 0))).res.html.scripts], []); // not in editmode
  const ctx = await run(page(5, 2));
  assertEquals([...ctx.res.html.scripts], ["/m/cms.frontend.ai.chat/pub/chat.js"]);
  assertEquals(ctx.res.html.jsData.qino["cms.frontend.ai.chat"], { page: 7, editmode: true });
  assertEquals(Object.keys(ctx.res.csp["script-src"]).length > 0, true); // markdown
});

Deno.test("cms.frontend.ai.chat: the user's session stays, a foreign or fresh one is started anew", async () => {
  const owners: Record<number, number> = { 10: 5, 11: 6 };
  let stored: number | undefined, inserted = 0;
  const leaf = Object.assign((value: number) => { stored = value; }, { then: (resolve: (v: unknown) => void) => resolve(stored) });
  const ctx = {
    userId: 5,
    settings: { "cms.frontend.ai.chat": { session: leaf } },
    app: {
      db: {
        one: (strings: TemplateStringsArray, ...values: unknown[]) =>
          Promise.resolve(strings.join("?").includes("ai_agent") ? 3 : owners[Number(values[0])]),
        table: () => ({ insert: () => Promise.resolve(20 + inserted++) }),
      },
    },
  };
  const { get, post } = (api as any).session;
  stored = 10;
  assertEquals(await get.execute({}, ctx), { id: 10 });
  stored = 11; // someone else's
  assertEquals(await get.execute({}, ctx), { id: 20 });
  assertEquals(stored, 20);
  assertEquals(await post.execute({}, ctx), { id: 21 });
  assertEquals(stored, 21);
});

Deno.test("cms.frontend.ai.chat: what changed on a page since a change, each node with its parent", async () => {
  let access = 2, asked: unknown[] = [];
  const app = {
    db: {
      one: () => Promise.resolve(9),
      query: (_: TemplateStringsArray, ...values: unknown[]) => (asked = values, Promise.resolve([{ id: 5, basis: 3 }, { id: 6, basis: null }])),
    },
  };
  fakeCms(app, { node: () => Promise.resolve({ access: () => access }) });
  const { get } = (api as any).changed, ctx = { app };
  assertEquals(await get.execute({ page: 7 }, ctx), { last: 9, nodes: [] }); // where to go on from
  assertEquals(await get.execute({ page: 7, after: 4 }, ctx), { last: 9, nodes: [{ id: 5, basis: 3 }, { id: 6, basis: undefined }] });
  assertEquals(asked, [7, 4, 9]);
  access = 1; // not for who may not edit the page
  assertEquals(await get.execute({ page: 7, after: 4 }, ctx), { last: 0, nodes: [] });
});
