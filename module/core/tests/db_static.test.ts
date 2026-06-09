import { assertEquals } from "./deps.ts";
import { Db } from "../lib/Db.ts";

Deno.test("Db.quote escapes SQL string literals", () => {
  assertEquals(Db.quote(null), "NULL");
  assertEquals(Db.quote("a'b\\c\n"), "'a\\'b\\\\c\\n'");
});
