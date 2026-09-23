# cms.layout.deck.1

A one-page layout: every content block is a full screen, and while scrolling the
next card slides over the previous one. The header floats above.

No special markup: `main` is a normal [cms.cont.flexible](../cms.cont.flexible/)
container, and its children become cards only through [pub/main.css](pub/main.css):

```css
#content > [qcms-id] > [qcms-id] {
  position: sticky;
  top: 0;
  min-height: 100dvh;
}
```

A card can hold anything: text, an image, a table, a form. Even cards get the
plain background, odd ones `--color-area`; single cards are styled in the site's
css via `[qcms-id="42"]`.

Otherwise it works like [cms.layout.standard.1](../cms.layout.standard.1/README.md):
the module ships [template.html](template.html), the site gets its own copy on the
first render in edit mode, and both files are edited in the options panel (see
[cms.templateParser/moduleTemplate.ts](../cms.templateParser/moduleTemplate.ts)).

Ported from the seiler-spiess.ch layout of the PHP CMS, which needed ~1100 lines
of css and js. Now: `scroll-behavior` for smooth scrolling, `position: sticky` for
the stack, `flex-wrap` for the mobile menu, u2 for normalize — one template and
80 lines of css, no javascript.
