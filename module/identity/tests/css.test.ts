import { assertEquals, assertStringIncludes, testContext } from "../../core/tests/deps.ts";
import type { Ctx } from "../../core/mod.ts";
import * as identity from "../mod.ts";

const appFake = (brand: Record<string, string>, font?: { name: string; url: () => string }) => ({
  db: { one: () => font ? 7 : null },
  dbFiles: { file: () => font },
  settings: { identity: { brand } },
});

const css = (ctx: Ctx) => [...ctx.res.html.inlineStyles].join("");

Deno.test("identity: the brand becomes an inline style ahead of the stylesheets", async () => {
  const font = { name: "inter.woff2", url: () => "/dbFile/7/inter.woff2" };
  const ctx = await testContext({ app: appFake({ primaryColor: "#f09", fontFamily: "Inter" }, font) });
  await identity.css(ctx);
  assertStringIncludes(css(ctx), `@font-face{font-family:"Inter";src:url("/dbFile/7/inter.woff2")`);
  assertStringIncludes(css(ctx), `html{--color:#f09;--font-1:"Inter",sans-serif}`);
});

Deno.test("identity: an uploaded font without a name is named after the file", async () => {
  const font = { name: "My Brand.woff2", url: () => "/dbFile/7/font" };
  const ctx = await testContext({ app: appFake({}, font) });
  await identity.css(ctx);
  assertStringIncludes(css(ctx), `--font-1:"My Brand",sans-serif`);
});

Deno.test("identity: nothing set, nothing emitted", async () => {
  const ctx = await testContext({ app: appFake({}) });
  await identity.css(ctx);
  assertEquals(ctx.res.html.inlineStyles.size, 0);
});
