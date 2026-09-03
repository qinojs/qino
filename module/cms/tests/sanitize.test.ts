import { assertEquals } from "@qino/qino/tests";

import { imageStyles, policy, sanitizeHtml } from "../lib/sanitize.ts";

Deno.test("sanitizeHtml keeps the presentation an editor set and drops what executes", () => {
  assertEquals(
    sanitizeHtml('<p class="lead" style="color:red">Lead</p><script>alert(1)</script>'),
    '<p class="lead" style="color:red">Lead</p>',
  );
  assertEquals(sanitizeHtml('<a href="javascript:alert(1)">x</a>'), "<a>x</a>");
  assertEquals(sanitizeHtml('<a href="cmspid://7">x</a>'), '<a href="cmspid://7">x</a>');
  assertEquals(sanitizeHtml('<img src="data:image/png;base64,x" alt="a">'), '<img src="data:image/png;base64,x" alt="a" />');
  assertEquals(sanitizeHtml('<p onclick="alert(1)" id="x">t</p>'), "<p>t</p>");
});

// The cache must never hand one policy's answer to another.
Deno.test("sanitizeHtml caches per policy", () => {
  const strict = { ...policy, styles: imageStyles };
  const raw = '<img src="/a.jpg" style="width:10px; color:red">';
  assertEquals(sanitizeHtml(raw), '<img src="/a.jpg" style="width:10px;color:red" />');
  assertEquals(sanitizeHtml(raw, strict), '<img src="/a.jpg" style="width:10px" />');
  assertEquals(sanitizeHtml(raw), '<img src="/a.jpg" style="width:10px;color:red" />');
});

Deno.test("sanitizeHtml: a site may narrow the css properties a style carries", () => {
  const narrowed = { ...policy, styles: imageStyles };
  assertEquals(
    sanitizeHtml('<img src="/a.jpg" style="width:10px; color:red">', narrowed),
    '<img src="/a.jpg" style="width:10px" />',
  );
  // An element the list does not name keeps its style: only what is listed is restricted.
  assertEquals(sanitizeHtml('<p style="color:red">t</p>', narrowed), '<p style="color:red">t</p>');
});
