// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "@qino/qino/tests";

import { Node } from "../lib/Node.ts";

const schema = {
  properties: {
    width: { type: "string", default: "u2-width" },
  },
};

function node(settings?: string) {
  const app = {
    db: { table: () => ({ update: () => Promise.resolve() }) },
    fire: () => Promise.resolve(),
    modules: { get: () => ({ plugin: { cms: { node: { settingsSchema: schema } } } }) },
  };
  return new Node({ app } as any, 1, {
    id: 1,
    module: "test",
    type: "c",
    title_id: 1,
    ...(settings === undefined ? {} : { settings }),
  });
}

Deno.test("Node settings read schema defaults without storing them", async () => {
  const untouched = await node().init();
  assertEquals(untouched.settings.width(), "u2-width");
  assertEquals(untouched.vs.settings, undefined);

  const wide = await node('{"width":""}').init();
  assertEquals(wide.settings.width(), "");
});
