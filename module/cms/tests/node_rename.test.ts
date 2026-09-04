// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "@qino/qino/tests";

import { Node } from "../lib/Node.ts";

/** A parent with one named cont, on rows the test can rewrite the way an update would. */
function tree() {
  const rows: Record<string, any>[] = [
    { id: 1, basis: 0, type: "p", module: "test", title_id: 1 },
    { id: 2, basis: 1, type: "c", module: "test", title_id: 2, name: "teaser", sort: 1 },
  ];
  const created: Record<string, any>[] = [];
  const app: any = {
    db: {
      query: (_s: any, ...v: any[]) => Promise.resolve(rows.filter((r) => Number(r.basis) === Number(v.at(-1)))),
      table: () => ({
        update: (id: number, data: any) => {
          Object.assign(rows.find((r) => r.id === Number(id))!, data);
          return Promise.resolve();
        },
      }),
    },
    fire: (_name: string, e: any) => Promise.resolve(e),
    modules: { get: () => undefined },
  };
  const nodes = new Map<number, Node>();
  const cms: any = {
    app,
    node: (id: number, vs?: any) => {
      let n = nodes.get(Number(id));
      if (!n) nodes.set(Number(id), n = new Node(cms, Number(id), vs ?? rows.find((r) => r.id === Number(id))));
      return n.init();
    },
    filter: (map: Map<number, Node>) => Promise.resolve(map),
  };
  return { cms, created };
}

Deno.test("Node: renaming a cont updates the parent's name index", async () => {
  const { cms } = tree();
  const parent = await cms.node(1);
  const cont = await parent.cont("teaser");
  assertEquals(cont.id, 2);

  await cont.set("name", "intro");

  // the new name must find the same node — a stale index would create a second one
  assertEquals((await parent.cont("intro")).id, 2);
});
