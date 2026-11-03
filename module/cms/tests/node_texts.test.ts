// deno-lint-ignore-file no-explicit-any
import { test } from "node:test";
import { assertEquals } from "@qino/qino/tests";

import { Node } from "../lib/Node.ts";

/** A node without texts yet; `links` are the page_text rows written. */
function fixture() {
  const links: string[] = [];
  const text = (id: number) => ({ id });
  const app: any = {
    db: {
      indexCol: () => new Promise((r) => setTimeout(() => r(new Map()), 1)),
      transaction: (fn: () => unknown) => fn(),
      table: () => ({ insert: ({ name }: any) => (links.push(name), Promise.resolve("1")) }),
    },
    dbTexts: { generate: () => Promise.resolve(text(links.length + 1)), text },
  };
  return { node: new Node({ app } as any, 1), links };
}

test("Node: texts created in parallel are all known afterwards, none is created twice", async () => {
  const { node, links } = fixture();
  const names = ["intro", "contact", "rights"];
  await Promise.all(names.map((name) => node.text(name)));
  await Promise.all(names.map((name) => node.text(name)));
  assertEquals(links.sort(), [...names].sort());
});
