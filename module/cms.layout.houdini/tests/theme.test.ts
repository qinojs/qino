import { assertEquals, assertStringIncludes } from "@qino/qino/tests";

import { DESIGN_MARKER, safeValue, themeCss } from "../pub/theme.js";

Deno.test("houdini: visual design uses known tokens and keeps values inside declarations", () => {
  assertEquals(themeCss(), DESIGN_MARKER + "html{}");
  assertEquals(themeCss(null), DESIGN_MARKER + "html{}");
  assertEquals(themeCss({ unknown: "red", color: " #abc " }), DESIGN_MARKER + "html{--color:#abc}");
  const css = themeCss({
    "font-1": '"Example Font", sans-serif',
    width: "min(80rem, 100%)",
    "button-color": "oklch(40% .12 160)",
    "input-radius": "0",
  });
  assertStringIncludes(css, '--font-1:"Example Font", sans-serif');
  assertStringIncludes(css, "--button-color:oklch(40% .12 160)");
  assertStringIncludes(css, "--input-radius:0");
  assertEquals(safeValue('"游ゴシック", "خط عربي", sans-serif'), '"游ゴシック", "خط عربي", sans-serif');
  assertEquals(safeValue('"AT&T: Display ✦", sans-serif'), '"AT&T: Display ✦", sans-serif');
  assertEquals(safeValue("calc(1rem * 2)"), "calc(1rem * 2)");
  for (const value of ["red;color:blue", "red}body{display:none", "</style><script>alert(1)</script>", "red/*", "red*/", "red !important", "\\72 ed", "x".repeat(251), {}, 0])
    assertEquals(safeValue(value), "");
  assertEquals(themeCss({ color: "red;color:blue", "font-1": "</style>" }), DESIGN_MARKER + "html{}");
});
