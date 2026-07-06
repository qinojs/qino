import { assertEquals } from "../../core/tests/deps.ts";
import { toTools } from "../../core/mod.ts";
import { api, name, needs, settingsSchema } from "../plugin.ts";

Deno.test("cms.versions: module metadata is wired", () => {
  assertEquals(name, "cms.versions");
  assertEquals(needs, ["cms"]);
  assertEquals(settingsSchema.properties.draftmode.type, "boolean");
});

Deno.test("cms.versions: apt API exposes publish/page/log endpoints", () => {
  const tools = toTools(api);
  assertEquals(tools.map((tool) => tool.name), [
    "post_publishNode",
    "get_node",
    "get_log",
  ]);

  assertEquals(tools[0].parameters, {
    type: "object",
    properties: {
      pid: { type: "number" },
      options: { type: "object", additionalProperties: true },
    },
    required: ["pid"],
  });
});
