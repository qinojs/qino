import { checkCollisions, toTools, walk } from "@qino/qino";
import { assertEquals } from "@qino/qino/tests";

import { api } from "../api.ts";

Deno.test("cms api tree: has no route collisions", () => {
  for (const r of walk(api)) checkCollisions(r);
});

Deno.test("cms api tree: exposes expected stable tool names", () => {
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
