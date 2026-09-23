# cms.layout.luca

A layout for image-led sites — restaurants, hotels, studios. Like
[cms.layout.standard.1](../cms.layout.standard.1/README.md) it is just an HTML
template rendered by [cms.templateParser](../cms.templateParser/README.md); the
site gets its own copy on the first render in edit mode:

| file                                    | role                                   |
|-----------------------------------------|----------------------------------------|
| `template.html` (in the module)         | the shipped template, fallback         |
| `data/cms.layout.luca/template.html`    | the site's copy — wins while it exists |
| `data/cms.layout.luca/pub/main.css`     | the site's styles, linked by cms       |

Both are edited from the options panel via [fileEditor](../fileEditor/).

## What it does differently

**`#content` has no width limit.** `cms.layout.standard.1` wraps content in
`.u2-width` (one column). Here each section decides: one can span the full width
(e.g. a large image), the next stays narrow. Content modules must add `.u2-width`
themselves where they want it.

**The header ends in a call to action.** `action` is a cont on the layout page —
a phone link, a booking button, opening hours — edited once for all pages.

**The footer has four columns.** Logo and address, two free conts, and an image.
Below it a note and a second navigation for legal pages.

## Slots

Everything with `node=layout` is edited once for the whole site; `main` is the
content of each page.

| slot         | kind                    | intended for                        |
|--------------|-------------------------|-------------------------------------|
| `logo`       | image, layout           | shown in header and footer          |
| `nav`        | `cms.cont.nav3`, layout | main navigation                     |
| `action`     | `cms.cont.text`, layout | the call to action in the header    |
| `main`       | cont, per page          | the page itself                     |
| `address`    | `cms.cont.text`, layout | postal address under the footer logo|
| `footA`      | cont, layout            | free footer column                  |
| `footB`      | cont, layout            | free footer column                  |
| `footImage`  | image, layout           | illustration or map in the footer   |
| `footNote`   | `cms.cont.text`, layout | copyright line                      |
| `footNav`    | `cms.cont.nav3`, layout | imprint, privacy                    |

## Identity

Colors and font come from the [identity](../identity/) module, written into the
head before all stylesheets by `u2.identityCss()`; the site's css overrides them by
setting the same variable. The useful ones are in the created `main.css`,
commented out.

The footer address is still an editable cont, so a site types it a second time
besides identity. The template could use `{{identity.…}}` placeholders instead
(see [cms.templateParser](../cms.templateParser/README.md#placeholderfallback)).
