// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "./deps.ts";
import { DbTextManager } from "../lib/DbTextManager.ts";

Deno.test("DbTextManager: generate inserts empty text for strict sql mode", async () => {
  const inserts: Record<string, unknown>[] = [];
  const app = {
    languages: { def: "de" },
    db: {
      table(name: string) {
        assertEquals(name, "text");
        return {
          insert(values: Record<string, unknown>) {
            inserts.push({ ...values });
            values.id = 12;
            return "12";
          },
        };
      },
    },
  };

  const text = await new DbTextManager(app as any).generate();
  assertEquals(text.id, 12);
  assertEquals(inserts, [{ lang: "de", text: "" }]);
});
