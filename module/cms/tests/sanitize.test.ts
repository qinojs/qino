import { assertEquals } from "@qino/qino/tests";

import { imageStyles, policy, policyCss, policyOf, sanitizeHtml } from "../lib/sanitize.ts";

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

// The editor reads the same list the output enforces, in the grammar the rte parses.
Deno.test("policyCss renders the policy for the editor", () => {
  const css = policyCss();
  assertEquals(css.startsWith(":root{--u2-rte-elements:h1 h2 h3"), true);
  assertEquals(css.includes("--u2-rte-attributes:class dir lang style title, a(href target), img(src alt width height loading)"), true);
  assertEquals(css.includes("--u2-rte-protocols:href: http https mailto tel cmspid, img(src: http https data)"), true);
});

// Settings decide, but every consumer here is synchronous: a resolved policy is kept and refreshed
// behind the call, so a change shows up on the next render rather than turning the path async.
Deno.test("policyOf resolves the site's own policy in the background", async () => {
  const app = {
    dev: true,
    settings: { cms: { sanitize: { elements: "p a", attributes: "class, a(href)", protocols: "href: https" } } },
  };
  assertEquals(policyOf(app as never).elements, policy.elements, "The first call answers with what qino ships");
  await new Promise(resolve => setTimeout(resolve, 5));
  const site = policyOf(app as never);
  assertEquals(site.elements, ["p", "a"]);
  assertEquals(site.attributes, { "*": ["class"], a: ["href"] });
  assertEquals(site.protocols, { "*": { href: ["https"] } });
  assertEquals(sanitizeHtml('<p class="x" title="t">t</p><div>d</div>', site), '<p class="x">t</p>d');
});
