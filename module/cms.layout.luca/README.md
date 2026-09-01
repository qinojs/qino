# cms.layout.luca

An editorial layout for image-led sites — restaurants, hotels, studios, anything
that leads with pictures rather than with text. Like
[cms.layout.standard.1](../cms.layout.standard.1/README.md) it is nothing but an
HTML template rendered through
[cms.templateParser](../cms.templateParser/README.md), and the site takes over
its own copy on the first render in edit mode:

| file                                    | role                                   |
|-----------------------------------------|----------------------------------------|
| `template.html` (in the module)         | the shipped template, fallback         |
| `data/cms.layout.luca/template.html`    | the site's copy — wins while it exists |
| `data/cms.layout.luca/pub/main.css`     | the site's styles, linked by cms       |

Both are edited from the options panel via [fileEditor](../fileEditor/).

## What it does differently

**`#content` carries no measure.** `cms.layout.standard.1` wraps its content in
`.u2-width`, which puts every page in one column. Here the wrapper is the
content's own business: a section can bleed to both edges — a full-width image
beside a column of text — while the next one stays narrow. That is the whole
point of the layout; the price is that content modules have to bring their own
`.u2-width` where they want one.

**The header ends in a call to action.** `action` is a cont on the layout page,
so the site decides what it is — a phone link, a booking button, opening hours —
and edits it once for all pages.

**The footer is a row of four.** Brand block with logo and address, two free
conts, and one image — enough for contact, opening hours and an illustration
without prescribing which goes where. Below it a note and a second navigation
for the legal pages.

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
head ahead of every stylesheet by `u2.identityCss()` — a default that the site's
css overrides by declaring the same variable. The knobs worth touching are in
the created `main.css`, commented out.

The address and contact details in identity's settings are **not** read by the
template: [cms.templateParser](../cms.templateParser/README.md) has no
placeholder syntax yet (`{setting.x}` is listed there as an idea). Until it has
one, the footer address is an editable cont, which means a site that fills in
identity still types its address a second time.
