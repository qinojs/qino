import { assertEquals } from "../../core/tests/deps.ts";
import { toHono, toTools } from "../../core/lib/apt.ts";
import { api } from "../apt.ts";

Deno.test("cms apt tree: mounts through Hono adapter without setup errors", () => {
  const app = toHono(api);
  assertEquals(typeof app.fetch, "function");
});

Deno.test("cms apt tree: exposes expected stable tool names", () => {
  const names = new Set(toTools(api).map((tool) => tool.name));
  for (const name of [
    "get_tree",
    "get_node",
    "delete_node",
    "get_node_tree",
    "put_node_title",
    "put_node_visible",
    "post_node_copy",
    "put_node_access_users",
  ]) {
    assertEquals(names.has(name), true, name);
  }
});
