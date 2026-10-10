import { toTools } from "@qino/qino";
import { assertEquals } from "@qino/qino/tests";

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
    "tree_get",
    "nodes_get",
    "node_get",
    "node_delete",
    "node_tree_get",
    "node_title_put",
    "node_patch",
    "node_copy_post",
    "node_access_users_put",
    "node_api_post",
  ]) {
    assertEquals(names.has(name), true, name);
  }
});

Deno.test("cms: node API tools include path parameters and required input", () => {
  const tools = toTools(api);
  const title = tools.find((tool) => tool.name === "node_title_put");
  assertEquals(title?.parameters, {
    type: "object",
    properties: {
      node: { type: "number", description: "Node-ID" },
      value: { type: "string" },
      lang: { type: "string", description: 'Language code, e.g. "de". Default: current language.' },
    },
    required: ["node", "value"],
  });

  const copy = tools.find((tool) => tool.name === "node_copy_post");
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
