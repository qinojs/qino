import { test } from "node:test";
import { assertEquals } from "@qino/qino/tests";

import { fillPlaceholders, placeholderNames } from "../mod.ts";

test("template placeholders: names and fallbacks use one non-recursive grammar", () => {
  assertEquals([...placeholderNames("{{one}} {{two|fallback}} {{one}}")], ["one", "two"]);
  assertEquals(fillPlaceholders("{{one}} {{two|fallback}}", (name) => name === "one" ? "{{two}}" : undefined), "{{two}} fallback");
});
