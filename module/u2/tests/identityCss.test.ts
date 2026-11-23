import { test } from "node:test";
import { assertEquals, assertStringIncludes } from "@qino/qino/tests";

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { identityCss } from "../mod.ts";
import { variableTtf } from "./font.ts";

// deno-lint-ignore no-explicit-any
const appFake = (brand: Record<string, string>, font?: { name: string; url: () => string }): any => ({
  db: { table: () => ({ get: () => font && { $get: () => 7 } }) },
  dbFiles: { file: () => font },
  settings: { identity: { brand } },
});

test("u2: the identity brand becomes u2's variables", async () => {
  const font = { name: "inter.woff2", url: () => "/dbFile/7/inter.woff2" };
  const css = await identityCss(appFake({ primaryColor: "#f09", fontFamily: "Inter" }, font));
  assertStringIncludes(css, `@font-face{font-family:"Inter";src:url("/dbFile/7/inter.woff2")`);
  assertStringIncludes(css, `html{--color:#f09;--font-1:"Inter",sans-serif}`);
});

test("u2: an uploaded font without a name is named after the file", async () => {
  const font = { name: "My Brand.woff2", url: () => "/dbFile/7/font" };
  assertStringIncludes(await identityCss(appFake({}, font)), `--font-1:"My Brand",sans-serif`);
});

test("u2: no brand, no css", async () => {
  assertEquals(await identityCss(appFake({})), "");
});

test("u2: a variable font gets its weight and width ranges, read once in the background", async () => {
  const path = mkdtempSync(tmpdir() + "/qino-u2-") + "/v.ttf";
  writeFileSync(path, variableTtf());
  const font = { name: "v.ttf", path, url: () => "/dbFile/7/v.ttf" };
  const app = appFake({}, font);
  assertEquals((await identityCss(app)).includes("font-weight"), false); // the first request does not wait
  await new Promise((resolve) => setTimeout(resolve, 50));
  assertStringIncludes(await identityCss(app), "font-weight:100 900;font-stretch:62% 125%;font-display:swap");
});
