# emailguard

Email addresses on public pages are harvested by crawlers that read the markup with a regular
expression. This module rewrites every address in the rendered body so that reading the markup —
or its text — yields a broken address, while a visitor still sees, copies and clicks the real one.

Two forms appear on a page, and each gets the treatment it can carry:

**In text**, a hidden decoy is inserted in front of the `@`:

```html
info<span class=kqvhtz>bxlpr</span>@example.com
```

The span is `display:none` (an inline style, hashed for CSP). On screen the address is unchanged —
it also copies unchanged, since browsers exclude hidden text from a selection. Everything else gets
`infobxlpr@example.com`: a source regex, a tag stripper, and even a headless browser reading
`textContent`, which includes hidden text. **No script is involved**, so this form survives with
JavaScript off.

**In a `mailto:` href** nothing can be hidden, so the address is XOR'd with a per-response key and
base64url-encoded. `pub/main.js` restores it, and is only loaded on pages that actually have such a
link. The key lives in the page, so this is obfuscation, not secrecy — what it defeats is the
generic harvester, not someone targeting this site.

The class name, the decoy word and the key are random per response, so none of them is a stable
pattern to strip.

## Not touched

`<script>`, `<style>` and `<textarea>` blocks, comments, and addresses in any attribute other than an
anchor's `mailto:` href — an attribute has nowhere to hide a decoy, and no script could tell which
values were addresses.

Signed-in requests are skipped entirely: the backend and inline editing must see, and save, real
addresses.

## Cost

The scan is anchored on the `@`: the address regex is a lookbehind for the local part, so the engine
looks for a literal instead of testing every position. On a 250 KB body that is **0.4 ms** per page,
against 3.9 ms for the same pass written the obvious way round. A page whose body holds no `@` at
all costs **0.005 ms** — the whole module ends at a single `includes("@")`.

Per address the context is then decided locally (the nearest `<` and `>` before it); the ranges of
the skipped blocks are scanned once, and only if some address could sit in one.

The client side is a single `querySelectorAll` over the mailto anchors, on the pages that have one.
The old PHP module walked every node and every attribute of the document instead — and replaced
every `@` in the response, `@media` and `@import` included.
