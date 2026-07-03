import { assertEquals } from "../../core/tests/deps.ts";
import type { AptNode } from "../../core/mod.ts";
import { api, dbSchema, name, needs } from "../plugin.ts";

Deno.test("cms.image_editor: module metadata is wired", () => {
  assertEquals(name, "cms.image_editor");
  assertEquals(needs, ["cms", "cms.versions"]);
  // hpos/vpos focus point is merged onto the (versioned) `file` table as floats.
  const file = dbSchema.properties.file.additionalProperties.properties;
  assertEquals(file.hpos.type, "number");
  assertEquals(file.vpos.type, "number");
});

Deno.test("cms.image_editor: api exposes meta/history/restore endpoints", () => {
  assertEquals(typeof (api.meta[":file"] as AptNode).get!.execute, "function");
  assertEquals(typeof (api.meta[":file"] as AptNode).put!.execute, "function");
  assertEquals(typeof (api.history[":file"] as AptNode).get!.execute, "function");
  assertEquals(typeof (api.restore[":file"] as AptNode).post!.execute, "function");
});
