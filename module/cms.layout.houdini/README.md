# cms.layout.houdini

A complete, adaptable frontend layout built on **u2 1.8.0**. A spacious content
measure, fluid headings, a compact brand header, nested navigation, language
selection and a flexible footer work together without a frontend build step.
Brand color, accent, background and uploaded font come from `identity`.

Install the module and select `cms.layout.houdini` as a page's layout in the CMS.
The module has no required configuration. Its dependencies provide the navigation,
language selector, flexible contents and text editor.

## Design editor

The page's **Houdini** options panel edits the global layout page. Changes apply
to every page using Houdini in this app; a different app has its own settings,
template, CSS and contents. WRITE access on the global layout page is required.

The editor previews changes when the visible page uses this layout. **Save design** stores them and
reloads the page. **Discard changes** restores the values from when the panel
opened. Closing the panel removes unsaved previews. Clear a field to inherit the
default again, or choose **Use defaults** to clear them all before saving. Color
fields also offer native color pickers. Fields accept CSS values, including `var()`, `clamp()` and font
stacks; invalid values cannot be submitted.

Preview changes use CSSOM on the server-built design stylesheet, keeping both
its cascade position and its CSP authorization. No extra inline stylesheet is
inserted while editing.

| Group | Controls |
|---|---|
| Colors | Brand, accent, page background, text, surface and line colors; light/dark scheme |
| Typography | Body and heading fonts, base size, text width, line heights, heading weight and letter spacing |
| Spacing | Content width, base spacing, corner radius and line width |
| Controls | Shared padding, corner radius and border width |
| Buttons | Background, text and radius independently of inputs |
| Inputs | Background, text, border color and radius independently of buttons |

Fonts use installed fonts, the font uploaded through identity, or `@font-face`
rules in site CSS. Entering a family name does not fetch an external font. System
fonts work immediately and do not require third-party requests.

The settings live in `design` on the global layout page. Keys correspond directly
to CSS custom properties, without the leading `--`; the editor and server share
[pub/theme.js](pub/theme.js). u2 remains the source of the palette and basic
control tokens. The layout additionally offers `--font-size`, `--button-color`,
`--button-text`, `--button-radius`, `--input-bg`, `--input-text`, `--input-line` and
`--input-radius`. Heading weight, letter spacing and line height have the matching
`--heading-weight`, `--heading-spacing` and `--heading-line-height` tokens.
`--measure` limits prose lines to `70ch` by default (`none` removes the limit).
`--color-scheme` accepts `light`, `dark` or `light dark`. Separate input/button values inherit the shared u2 values until
set. There is no tenant state in module globals.

## Everything can be changed

The visual editor is a starting point. **Template and CSS** opens the site's own
files with the existing file editor. Change markup, rearrange slots, replace
modules, add sections, restyle headings or controls, or replace the whole design.

| File | Role |
|---|---|
| Module `template.html` | Shipped starting point |
| `data/cms.layout.houdini/template.html` | Site template, used while it exists |
| `data/cms.layout.houdini/pub/main.css` | Site CSS, loaded after the layout styles |

The first edit-mode render creates the site files once. Opening a missing file
from the panel creates its starting point first. Updates never overwrite site
files. An empty template is an intentional empty override; deleting it restores
the shipped template. Removing a slot from the template does not delete its
stored content. A removed CSS file stays removed until explicitly opened again.

The cascade is: **u2 → Houdini defaults → identity → saved design → site CSS**.
Identity and saved design are unlayered `html` declarations; layout defaults sit
in a cascade layer above u2's normalize layer. Site CSS is unlayered and loaded
last. Override the layout through its ids when changing individual elements:

```css
html {
  --color: #73432f;
  --font-2: Georgia, serif;
  --width: 68rem;
  --button-radius: 3rem;
  --input-radius: .25rem;
}
#container.houdini {
  #head { border-block-end: 0; }
  #content h1 { max-inline-size: 22ch; font-weight: 450; }
  #foot { background: var(--color-area); }
}
```

The u2 release can be changed separately in the panel after checking the site's
CSS. An empty or incomplete release keeps the shipped pin.

Content typography and control defaults deliberately have low selector
specificity. u2 loads first, then the layout, then content modules; site CSS is
moved to the end. A content module can keep its own button or heading styles
without fighting layout ids. The layout's structural parts still use ids.

## Content areas

All `node=layout` parts are shared by the site. `main` belongs to each page.
The template declares the contents; a custom template can omit or replace any
declaration. Navigation and language selector keep their own CMS options.

| Name | Kind | Intended use |
|---|---|---|
| `skip`, `menu`, `close`, `languageLabel` | Layout text | Editable and translatable interface labels |
| `notice` | Optional layout text | Announcement or service message; empty is hidden |
| `nav` | `cms.cont.nav4` | Main navigation from the page tree |
| `lang` | `cms.cont.lang.choose2` | Languages of the current page; links or select |
| `action` | Optional layout text | Header link or `.btn` call to action |
| `main` | Flexible content on each page | Full-width content; sections use `u2-width` |
| `about` | Optional layout text | Footer description or contact information |
| `foot` | Flexible layout content | Footer columns, contacts or other modules |
| `footNote` | Optional layout text | Copyright or closing note |
| `footNav` | Flexible layout content | Legal links or a navigation module |

By default a newly created flexible `main` starts with one section containing an editable
`h1` copied from the page title in each language. An emptied main stays empty;
later title edits do not overwrite editorial content. Existing contents keep
their selected modules. A main already initialized by the site's flexible-content
defaults also keeps its content. Logo and public site name come from identity.
Brand links use `{{cms.layout.houdini.home}}`, the current language's site entrance
under the app's mount path. They work at any page depth; the CMS home redirect
still decides which page visitors reach.

## Navigation and accessibility

- Ordinary CMS links retain URLs, active state, edit markers and access filtering.
- Wide mouse layouts show submenus on hover and keyboard focus. Deeper levels
  remain ordinary nested lists inside the panel, with a scrollable height limit.
- Small screens and devices without hover use a native popover drawer. Escape,
  light dismiss and focus return come from the browser. Links close the drawer;
  `aria-expanded` follows its actual open state.
- u2's `responsive` element also switches to the drawer when the actual brand,
  navigation and tools no longer fit. Long titles, extra languages and larger
  fonts do not need a separate breakpoint setting. Without JavaScript the wide
  navigation remains a wrapping list.
- Without JavaScript, the native buttons still open and close the drawer. Without
  popover support, the navigation remains an ordinary visible list.
- The skip link appears on focus and targets the focusable main landmark.
- Language links keep their native names, `lang`, `hreflang` and active state.
- Select mode gets its accessible name from the editable `languageLabel` text;
  the association is restored when the CMS reloads the selector.
- Logical CSS properties support right-to-left content. u2 supplies reduced
  motion and print defaults; layout navigation controls are hidden in print.
- Button and announcement defaults adapt their foreground/background pairing
  to the automatic light/dark scheme. Custom brand colors and control colors
  remain entirely under the site's control.
- No cookie banner is injected: a site adds consent UI when its integrations
  require it.

## File API

The existing layout file API is available for tools and integrations:

```
/cms.layout.houdini/node/:node/codefiles/html
/cms.layout.houdini/node/:node/codefiles/css
```

`:node` must use this layout. Both GET and PUT require WRITE on the global layout
page. GET returns `{ content }`, including the starting point for a missing file.
PUT accepts `{ content }`, saves the entire file and returns rendered page HTML.
CSS saves change the app's asset revision. Read before writing; files are shared
by every page using this layout.
