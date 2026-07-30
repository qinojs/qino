import { assertEquals } from "../../core/tests/deps.ts";
import { checkCollisions, toTools, walk } from "../../core/mod.ts";
import { api } from "../apt.ts";

Deno.test("cms apt tree: has no route collisions", () => {
  for (const r of walk(api)) checkCollisions(r);
});

Deno.test("cms apt tree: exposes expected stable tool names", () => {
  const names = new Set(toTools(api).map((tool) => tool.name));
  for (const name of [
    "get_tree",
    "get_node",
    "delete_node",
    "get_node_tree",
    "put_node_title",
    "patch_node",
    "post_node_copy",
    "put_node_access_users",
  ]) {
    assertEquals(names.has(name), true, name);
  }
});
