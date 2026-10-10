import { checkCollisions, toTools, walk } from "@qino/qino";
import { assertEquals } from "@qino/qino/tests";

import { api } from "../api.ts";

Deno.test("cms api tree: has no route collisions", () => {
  for (const r of walk(api)) checkCollisions(r);
});

Deno.test("cms api tree: exposes expected stable tool names", () => {
  const names = new Set(toTools(api).map((tool) => tool.name));
  for (const name of [
    "tree_get",
    "node_get",
    "node_delete",
    "node_tree_get",
    "node_title_put",
    "node_patch",
    "node_copy_post",
    "node_access_users_put",
  ]) {
    assertEquals(names.has(name), true, name);
  }
});
