import { test } from "node:test";
import { assertEquals } from "@qino/qino/tests";

import { coerceSetting } from "./coerceSettings.ts";

test("coerceSetting: PHP's strings in the types the schema declares", () => {
  const schema = {
    properties: {
      startPage: { type: "integer" }, level: { type: "integer" }, factor: { type: "number" }, deep: { type: "boolean" },
      flat: { type: "boolean" }, title: { type: "string" }, either: { type: ["integer", "string"] },
      nested: { type: "object", properties: { max: { type: "integer" } } },
    },
  };
  const php = { startPage: "10", level: "", factor: "0.5", deep: "1", flat: "", title: "10", either: "7", nested: { max: "3" }, other: "1", odd: "x" };
  assertEquals(coerceSetting(php, schema), {
    startPage: 10, factor: 0.5, deep: true, flat: false, title: "10", either: "7", nested: { max: 3 }, other: "1", odd: "x",
  });
  assertEquals(coerceSetting("1.5", { type: "integer" }), "1.5"); // no fit: left alone
});
