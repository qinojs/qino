import { assertEquals } from "../../core/tests/deps.ts";
import { toTools } from "../../core/mod.ts";
import { api } from "../api.ts";

const verbs = new Set(["get", "post", "put", "delete", "patch"]);

function collectVerbs(tree: Record<string, unknown>, out: Array<Record<string, unknown>> = []) {
  for (const value of Object.values(tree)) {
    if (!value || typeof value !== "object") continue;
    for (const [key, verb] of Object.entries(value)) {
      if (verbs.has(key) && verb && typeof verb === "object") out.push(verb as Record<string, unknown>);
    }
    collectVerbs(value as Record<string, unknown>, out);
  }
  return out;
}

Deno.test("cms: api tree exposes expected core tools", () => {
  const tools = toTools(api);
  const names = new Set(tools.map((tool) => tool.name));
  for (const name of [
    "get_tree",
    "get_nodes",
    "get_node",
    "delete_node",
    "get_node_tree",
    "put_node_title",
    "patch_node",
    "post_node_copy",
    "put_node_access_users",
    "post_node_api",
  ]) {
    assertEquals(names.has(name), true, name);
  }
});

Deno.test("cms: node API tools include path parameters and required input", () => {
  const tools = toTools(api);
  const title = tools.find((tool) => tool.name === "put_node_title");
  assertEquals(title?.parameters, {
    type: "object",
    properties: {
      node: { type: "number", description: "Node-ID" },
      value: { type: "string" },
      lang: { type: "string", description: 'Language code, e.g. "de". Default: current language.' },
    },
    required: ["node", "value"],
  });

  const copy = tools.find((tool) => tool.name === "post_node_copy");
  assertEquals(copy?.parameters, {
    type: "object",
    properties: {
      node: { type: "number", description: "Node-ID" },
      deep: { type: "boolean", description: "If true, sub-pages are copied too" },
    },
    required: ["node"],
  });
});

Deno.test("cms: api tool names remain unique", () => {
  const names = toTools(api).map((tool) => tool.name);
  assertEquals(new Set(names).size, names.length);
});

Deno.test("cms: api verbs declare access and descriptions", () => {
  for (const verb of collectVerbs(api)) {
    assertEquals(typeof verb.execute, "function");
    assertEquals(typeof verb.access, "function");
    assertEquals(typeof verb.description, "string");
    assertEquals(String(verb.description).trim().length > 0, true);
  }
});
