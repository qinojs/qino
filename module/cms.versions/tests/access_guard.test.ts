// deno-lint-ignore-file no-explicit-any
import { assertEquals, testContext, fakeRender } from "../../core/tests/deps.ts";
import { requestStorage } from "../../core/mod.ts";
import { fakeCms } from "../../cms/tests/deps.ts";
import { getForNode, logDetails } from "../serverInterface.ts";

// Fake cms with per-node access levels + a db answering the guard queries.
// `changed` = node_changed rows for the log (node_id, page_id, data).
async function setup(access: Record<number, number>, changed: Array<{ node_id: number; page_id: number; data?: any }>) {
  const ctx = await testContext({ userId: 9, app: {
    languages: {},
    t: (s: TemplateStringsArray) => Promise.resolve(s.join("")), // app.t.bind(languages), used as tagged template
    db: {
      query: (...a: any[]) => {
        const [text] = fakeRender(a[0], a.slice(1));
        if (text.includes("FROM node_changed")) return Promise.resolve(changed.map((c) => ({ ...c, data: JSON.stringify(c.data ?? {}) })));
        return Promise.resolve([]);
      },
      row: () => Promise.resolve({ time: 1, ip: "1.2.3.4", user_agent: "UA", email: "a@b.c" }),
    },
  } });
  fakeCms(ctx.app, {
    node: (id: number) => ({
      id: Number(id),
      vs: { type: "p" },
      access: () => Promise.resolve(access[Number(id)] ?? 0),
      title: () => Promise.resolve({ string: () => Promise.resolve("T") }),
    }),
  } as never);
  ctx.lang = "de";
  return ctx;
}

Deno.test("213: getForNode returns empty for a user without edit access", async () => {
  const ctx = await setup({ 5: 1 }, []); // access 1 (READ) < 2
  await requestStorage.run(ctx, async () => {
    assertEquals(await getForNode(ctx, 5), []);
  });
});

Deno.test("213: logDetails returns null when no affected page is editable", async () => {
  const ctx = await setup({ 5: 1, 6: 0 }, [{ node_id: 5, page_id: 5 }, { node_id: 6, page_id: 6 }]);
  await requestStorage.run(ctx, async () => {
    assertEquals(await logDetails(ctx, 42), null);
  });
});

Deno.test("213: logDetails returns null when the log touched no known node", async () => {
  const ctx = await setup({ 5: 3 }, []); // no node_changed rows for this log
  await requestStorage.run(ctx, async () => {
    assertEquals(await logDetails(ctx, 42), null);
  });
});

Deno.test("213: logDetails exposes details + only editable-node messages", async () => {
  const ctx = await setup(
    { 5: 0, 6: 2 }, // page 5 hidden, page 6 editable
    [
      { node_id: 5, page_id: 5, data: { table: "page_text", op: "insert", name: "secret" } },
      { node_id: 6, page_id: 6, data: { table: "page", op: "update", cols: ["visible"] } },
    ],
  );
  await requestStorage.run(ctx, async () => {
    const res = await logDetails(ctx, 42);
    assertEquals(res.usr, "a@b.c");
    assertEquals(res.ip, "1.2.3.4");
    assertEquals(res.messages.length, 1); // only the editable page 6 row
    assertEquals(res.messages[0].includes("Visibility changed"), true);
    assertEquals(res.messages[0].includes("secret"), false); // page 5 row filtered out
  });
});
