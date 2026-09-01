# cms.layout.deck.1

A one-page layout: every content block of the page is a screen of its own, and
the blocks stack while you scroll — the next card slides over the last one.
The header floats above the deck.

Nothing about that is special markup. The page's `main` is an ordinary
[cms.cont.flexible](../cms.cont.flexible/) container, and its children become
the cards purely through [pub/main.css](pub/main.css):

```css
#content > [qcms-id] > [qcms-id] {
  position: sticky;
  top: 0;
  min-height: 100dvh;
}
```

So a card is whatever the editor puts in: text, an image, a table, a form. Even
cards get the plain background, odd ones `--color-area`; a single card is styled
through the id cms puts on every content block (`[qcms-id="42"]`), which is what
the site's own css file is for.

The layout works the same way as
[cms.layout.standard.1](../cms.layout.standard.1/README.md): the module ships
[template.html](template.html), the site takes over its own copy on the first
render in edit mode, and both files are edited from the options panel. The
mechanism lives in
[cms.templateParser/moduleTemplate.ts](../cms.templateParser/moduleTemplate.ts).

Ported from the seiler-spiess.ch layout of the PHP CMS, which needed
~1100 lines of css and js for the same result: smooth scrolling is
`scroll-behavior`, the stack is `position: sticky`, the mobile menu is
`flex-wrap`, and normalize is u2's. What is left is one template and 80 lines of
css, without a single line of javascript.
