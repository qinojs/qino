import { assertEquals } from "@std/assert";

import { settingsSchema } from "../plugin.ts";

Deno.test("identity: every text setting has a JSON Schema maxLength", () => {
  const missing: string[] = [];
  const visit = (schema: Record<string, unknown>, path = "identity") => {
    if (schema.type === "string" && typeof schema.maxLength !== "number") missing.push(path);
    for (const [name, child] of Object.entries(schema.properties as Record<string, Record<string, unknown>> ?? {})) {
      visit(child, `${path}.${name}`);
    }
  };
  visit(settingsSchema as Record<string, unknown>);
  assertEquals(missing, []);
});
