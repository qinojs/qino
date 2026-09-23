# emailguard

Crawlers harvest email addresses from pages with regular expressions. This module rewrites every
address in the page so the markup (and its text) contain a broken address, while visitors still
see, copy and click the real one.

Two cases:

**In text**, a hidden decoy is inserted in front of the `@`:

```html
info<span class=kqvhtz>bxlpr</span>@example.com
```

The span is `display:none` (inline style, hashed for CSP). On screen and when copied the address
is correct, since hidden text is not copied. Everything else reads `infobxlpr@example.com`: source
regexes, tag strippers, even a headless browser reading `textContent`. **No script needed**, so it
works without JavaScript.

**In a `mailto:` href** nothing can be hidden, so the address is XOR'd with a per-response key and
base64url-encoded. `pub/main.js` decodes it and is only loaded on pages with such a link. The key is
in the page, so this only stops generic harvesters, not someone targeting this site.

Class name, decoy word and key are random per response, so there is no fixed pattern to strip.

## Not touched

`<script>`, `<style>` and `<textarea>` blocks, comments, and addresses in attributes other than
`mailto:` hrefs — an attribute can't hold a hidden decoy.

Requests of signed-in users are skipped: the backend and inline editing must see and save real
addresses.

## Cost

The regex starts at the `@` and looks back for the local part, so the engine searches a literal
instead of trying every position: **0.4 ms** for a 250 KB page, vs. 3.9 ms the straightforward way.
A page without `@` costs **0.005 ms** (one `includes("@")`).

For each address the context is checked locally (the nearest `<` and `>` before it); skipped blocks
are only located if an address might be inside one.

In the browser it is one `querySelectorAll` over mailto links, only on pages that have them. (The
old PHP module walked every node and attribute and replaced every `@`, including `@media` and
`@import`.)
