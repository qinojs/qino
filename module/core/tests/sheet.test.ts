import { strFromU8, unzipSync } from "fflate";

import { assert, assertEquals } from "./deps.ts";
import { csv } from "../lib/sheet/csv.ts";
import { xlsx } from "../lib/sheet/xlsx.ts";

Deno.test("csv: RFC 4180 with a BOM; formulas stay text, numbers numbers", () => {
  assertEquals(
    csv([["Name", "Note"], ['A "quote"', "=SUM(1)"], ["+1", -5], ["@x", "\tx"], ["a,b", ["x", "y"]], [null, "line\nbreak"]]),
    "\uFEFF" + [
      `"Name","Note"`,
      `"A ""quote""","'=SUM(1)"`,
      `"'+1","-5"`,
      `"'@x","'\tx"`,
      `"a,b","x, y"`,
      `"","line\nbreak"`,
    ].join("\r\n") + "\r\n",
  );
});

Deno.test("csv: no value breaks out of its cell or row", () => {
  const evil = ['x","=1+1","y', 'a"\r\n"b', '"', '",', "\r\n=2", ";,\t|"];
  const out = csv([evil]);
  // each value is one quoted cell: quotes doubled, a formula start kept as text, nothing else special
  const cells = evil.map((v) => `"${(/^[=+\-@\t\r\n]/.test(v) ? "'" + v : v).replaceAll('"', '""')}"`);
  assertEquals(out, "\uFEFF" + cells.join(",") + "\r\n");
  // read back by the RFC: split on commas outside quotes, undouble quotes
  const read = [...out.slice(1, -2).matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map((m) => m[1].replaceAll('""', '"'));
  assertEquals(read, evil.map((v) => /^[=+\-@\t\r\n]/.test(v) ? "'" + v : v));
});

Deno.test("xlsx: one sheet; numbers stay numbers, text is text and never a formula", async () => {
  const wide = Array.from({ length: 28 }, (_, i) => i);
  const files = unzipSync(await xlsx([["=SUM(1)", -5, '<b>"x"</b> & y', "a\u0001b", ["p", "q"], null], wide]));
  for (const part of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels"]) assert(files[part], part);
  const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
  const cell = (ref: string) => sheet.match(new RegExp(`<c r="${ref}"[^>]*>.*?</c>`))?.[0];
  assertEquals(cell("A1"), '<c r="A1" t="inlineStr"><is><t xml:space="preserve">=SUM(1)</t></is></c>');
  assertEquals(cell("B1"), '<c r="B1"><v>-5</v></c>');
  assertEquals(cell("C1"), '<c r="C1" t="inlineStr"><is><t xml:space="preserve">&lt;b&gt;&quot;x&quot;&lt;/b&gt; &amp; y</t></is></c>');
  assertEquals(cell("D1"), '<c r="D1" t="inlineStr"><is><t xml:space="preserve">ab</t></is></c>', "what XML cannot hold is left out");
  assertEquals(cell("E1"), '<c r="E1" t="inlineStr"><is><t xml:space="preserve">p, q</t></is></c>');
  assertEquals(cell("F1"), '<c r="F1" t="inlineStr"><is><t xml:space="preserve"></t></is></c>');
  assertEquals(cell("AB2"), '<c r="AB2"><v>27</v></c>', "columns go on after Z");
  assert(!sheet.includes("<f>"), "no formula anywhere");
});
