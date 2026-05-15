import { assertEquals } from "../../../deps.ts";
import { s, toJsonSchema } from "../lib/StandardSchema.ts";

Deno.test("StandardSchema: nested object/array issues include paths", () => {
  const Schema = s.object({
    title: s.string(),
    tags: s.array(s.string()),
    meta: s.object({ visible: s.boolean() }),
  });

  const res = Schema["~standard"].validate({
    title: 5,
    tags: ["ok", 7],
    meta: { visible: "yes" },
  });

  assertEquals(res.issues, [
    { message: "expected string", path: ["title"] },
    { message: "expected string", path: ["tags", 1] },
    { message: "expected boolean", path: ["meta", "visible"] },
  ]);
});

Deno.test("StandardSchema: optional accepts null and default applies on undefined", () => {
  const Schema = s.object({
    optional: s.optional(s.string()),
    count: s.number().default(3),
  });

  assertEquals(Schema["~standard"].validate({ optional: null }), { value: { count: 3 } });
  assertEquals(Schema["~standard"].validate({ optional: "x", count: 4 }), { value: { optional: "x", count: 4 } });
});

Deno.test("StandardSchema: record validates values and reports keyed paths", () => {
  const res = s.record(s.number())["~standard"].validate({ a: 1, b: "x" });
  assertEquals(res.issues, [{ message: "expected number", path: ["b"] }]);
});

Deno.test("StandardSchema: toJsonSchema keeps descriptions and required fields", () => {
  const Schema = s.object({
    title: s.string().describe("Title"),
    tags: s.array(s.string()).describe("Tags"),
    opt: s.optional(s.boolean()).describe("Optional flag"),
    count: s.number().default(1),
  }).describe("Root");

  assertEquals(toJsonSchema(Schema), {
    type: "object",
    properties: {
      title: { type: "string", description: "Title" },
      tags: { type: "array", items: { type: "string" }, description: "Tags" },
      opt: { type: "boolean", description: "Optional flag" },
      count: { type: "number" },
    },
    required: ["title", "tags"],
    description: "Root",
  });
});
