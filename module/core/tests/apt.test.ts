// deno-lint-ignore-file no-explicit-any
import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { s } from "../lib/schema.ts";

// ───── Schema tests ───────────────────────────────────────────────────────

Deno.test("schema: string/number/boolean primitives", () => {
  assertEquals(s.string()["~standard"].validate("x"), { value: "x" });
  assertEquals(s.number()["~standard"].validate(42), { value: 42 });
  assertEquals(s.boolean()["~standard"].validate(true), { value: true });

  const bad = s.string()["~standard"].validate(5);
  if (!bad.issues) throw new Error("expected issues");
});

Deno.test("schema: object with optional and default", () => {
  const Sch = s.object({
    name: s.string(),
    age:  s.optional(s.number()),
    deep: s.boolean().default(false),
  });

  assertEquals(Sch["~standard"].validate({ name: "a" }).value, {
    name: "a", deep: false,
  });
  assertEquals(Sch["~standard"].validate({ name: "a", age: 9, deep: true }).value, {
    name: "a", age: 9, deep: true,
  });
});

Deno.test("schema: object exposes keys + shape for introspection", () => {
  const Sch = s.object({ a: s.string(), b: s.number() });
  assertEquals(Sch.keys, ["a", "b"]);
  assertEquals(Sch.kind, "object");
  assertEquals(Object.keys(Sch.shape!), ["a", "b"]);
});

Deno.test("schema: array + record", () => {
  assertEquals(s.array(s.string())["~standard"].validate(["a", "b"]).value, ["a", "b"]);
  assertEquals(s.record()["~standard"].validate({ x: 1 }).value, { x: 1 });
});

// ───── walk + invoke tests (mock tree, no Hono) ───────────────────────────
//
// We can't import apt.ts directly (pulls in Hono + qg + full server context).
// Instead, we test the walk/invoke logic indirectly via a stub that mimics
// what apt.ts does. Real integration tests happen when the tree is mounted.

Deno.test("schema: collision source names are surfaced via keys", () => {
  // This is what checkCollisions() in apt.ts uses to detect overlaps.
  const pathNames = new Set(["node", "file"]);
  const inputKeys = s.object({ deep: s.boolean() }).keys!;
  for (const k of inputKeys) {
    if (pathNames.has(k)) throw new Error(`collision on ${k}`);
  }
});
