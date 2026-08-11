import { assertEquals } from "../../core/tests/deps.ts";
import type { ApiNode } from "../../core/mod.ts";
import { api, dbSchema } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };
const { name, dependencies } = manifest;

Deno.test("cms.image_editor: module metadata is wired", () => {
  assertEquals(name, "cms.image_editor");
  assertEquals(dependencies, ["cms", "cms.versions"]);
  // hpos/vpos focus point is merged onto the (versioned) `file` table as floats.
  const file = dbSchema.properties.file.additionalProperties.properties;
  assertEquals(file.hpos.type, "number");
  assertEquals(file.vpos.type, "number");
});

Deno.test("cms.image_editor: api exposes meta/history/restore endpoints", () => {
  assertEquals(typeof (api.meta[":file"] as ApiNode).get!.execute, "function");
  assertEquals(typeof (api.meta[":file"] as ApiNode).put!.execute, "function");
  assertEquals(typeof (api.history[":file"] as ApiNode).get!.execute, "function");
  assertEquals(typeof (api.restore[":file"] as ApiNode).post!.execute, "function");
});
