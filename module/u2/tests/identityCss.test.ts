import { assertEquals, assertStringIncludes } from "../../core/tests/deps.ts";
import { identityCss } from "../mod.ts";

// deno-lint-ignore no-explicit-any
const appFake = (brand: Record<string, string>, font?: { name: string; url: () => string }): any => ({
  db: { one: () => font ? 7 : null },
  dbFiles: { file: () => font },
  settings: { identity: { brand } },
});

Deno.test("u2: the identity brand becomes u2's variables", async () => {
  const font = { name: "inter.woff2", url: () => "/dbFile/7/inter.woff2" };
  const css = await identityCss(appFake({ primaryColor: "#f09", fontFamily: "Inter" }, font));
  assertStringIncludes(css, `@font-face{font-family:"Inter";src:url("/dbFile/7/inter.woff2")`);
  assertStringIncludes(css, `html{--color:#f09;--font-1:"Inter",sans-serif}`);
});

Deno.test("u2: an uploaded font without a name is named after the file", async () => {
  const font = { name: "My Brand.woff2", url: () => "/dbFile/7/font" };
  assertStringIncludes(await identityCss(appFake({}, font)), `--font-1:"My Brand",sans-serif`);
});

Deno.test("u2: no brand, no css", async () => {
  assertEquals(await identityCss(appFake({})), "");
});
