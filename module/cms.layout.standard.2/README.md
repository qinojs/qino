# cms.layout.standard.2

An HTML/CSS frontend layout with identity branding, Nav4 and full-width main
content. Uses the same u2 release as the CMS editor. Typography, colors, controls,
focus, list defaults and flex gaps come from u2; layout rules only handle the shell
and navigation arrangement. u2 print and reduced-motion styles load server-side.
The standard adopts u2 print behavior, including hiding all header/footer elements. No required banner, hero,
sticky header or hover menu.

The shipped template starts with three ordinary CMS contents:

| Name | Owner | Initial module |
|---|---|---|
| `nav` | Global layout page | `cms.cont.nav4`, with `pathOnly` |
| `main` | Current page | `cms.cont.flexible`, initially a Section with Text |
| `foot` | Global layout page | `cms.cont.flexible` |

Only newly created main content receives the starter section. Its text contains
an editable h1 copied from the page title in each configured language. Later page
title changes do not rewrite that text. Emptying main or changing its module does
not restore the starter content. Existing navigation settings remain unchanged.
Initial defaults apply only to the first matching declaration for each target in the
selected template. Markup owned by editable CMS text is not initialized as a subtree.
Explicit `node=page` initializes that page, even when the layout is rendered on a content node.

Main has no width limit: content chooses its own width. Sections use `u2-width`.
Logo, name, colors and font come from identity; without a name the home link says
Home. `cms-link=parent(1)` follows the usual CMS tree; adapt it for a different tree.

Without JavaScript or Popover support the navigation remains visible. On small
viewports `pub/navigation.js` enhances the same list with a native popover. Replace
the script to change its breakpoint or behavior; no second mobile navigation exists.

## Site files

The first render in edit mode copies `template.html` and a small `pub/main.css`
into `data/cms.layout.standard.2/`, provided that directory does not already exist.
JavaScript is copied when explicitly opened; the site copy replaces the shipped navigation script.
The options panel opens these files through fileEditor. Editing them requires
WRITE on the global layout page, not just on the current page.

- The site's template wins while it exists; updates never overwrite it.
- Deleting the template selects the shipped fallback. An empty file is an intentional empty override.
- Deleting site CSS leaves the shipped layout styles; deleting site JS selects the shipped
  navigation script. Normal rendering does not recreate deleted files. Explicitly opening a
  missing file through the panel or API creates its starting point again.
- Existing contents survive template changes, including removal of their declarations.

Styles load in order: u2, layout, site. Content modules may add their own styles
afterward. Scope overrides to the layout's ordinary HTML hooks; avoid numeric CMS
IDs and editor wrapper depths. Site HTML may add, remove or replace any content.

The module is available through the module store; it does not change the default
installation profile or switch existing pages to this layout.

## File API

Like `cms.cont.html`, the module exposes GET and PUT for each file:

```
/cms.layout.standard.2/node/:node/codefiles/html
/cms.layout.standard.2/node/:node/codefiles/css
/cms.layout.standard.2/node/:node/codefiles/js
```

`:node` identifies a page using this layout. The files are shared by every page
using this layout in the same app. Access requires a signed-in user with WRITE
on the global layout page. Editing an individual page does not grant access to
these app-wide files.

GET creates the selected file if missing and returns `{ content }`. PUT accepts
`{ content }`, saves the whole file and returns rendered page HTML. CSS and JS
changes also update the app's asset revision. An empty JS file disables the
shipped navigation enhancement while keeping the link list visible.
