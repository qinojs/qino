# cms.layout.standard.2

An HTML/CSS frontend layout: identity branding, Nav4, full-width main. Typography, colors,
focus and print come from u2; the layout CSS only arranges the shell. No banner, hero, sticky
header or hover menu.

It pins its own u2 release (`U2_VERSION`), so a CMS update cannot change its look. The panel sets
another one for the site (`u2Version` on the global layout page), once its CSS is checked against it.
Contents load that release through the import map entry `@u2/`; the panel keeps CMS's own (`@qino/u2/`).

| Content | Owner | Initial module |
|---|---|---|
| `nav` | Global layout page | `cms.cont.nav4` |
| `main` | Current page | `cms.cont.flexible`, starting with a Section and Text |
| `foot` | Global layout page | `cms.cont.flexible` |

A newly created flexible main starts with a section whose text holds an editable h1,
copied once from the page title in each language. Emptying main or giving it another
module in the template means no starter.

Main has no width limit; sections use `u2-width`, full-width content just omits it.
Logo, name, colors and font come from identity; without a name the home link says
Home. `cms-link=parent(1)` follows the usual CMS tree — adapt it for a different one.

## Navigation

One link list, no JavaScript. On small viewports the same list becomes a native
`popover` with an open and a close button; Escape, light dismiss and focus return are
the browser's. Wide viewports and browsers without popover support show the plain
list. Sub-levels are shown along the current path only (CSS, so Nav4 settings stay
free). Breakpoint and behaviour live in `pub/main.css`.

## Site files

The first render in edit mode copies `template.html` and a small `pub/main.css`
into `data/cms.layout.standard.2/`, if that directory does not exist yet. The panel
opens them in the file editor, writing a missing file's starting point first; editing
requires WRITE on the global layout page.

- The site's template wins while it exists; updates never overwrite it. Deleting it
  falls back to the shipped one until opened again; an empty file is an intentional empty override.
- Site CSS loads after the layout CSS. u2's base sits in a cascade layer; its utility
  classes don't, so override those through the layout's ids.
- Contents survive template changes, including removal of their declaration.

## File API

Like `cms.cont.html`, for agents and tools:

```
/cms.layout.standard.2/node/:node/codefiles/html
/cms.layout.standard.2/node/:node/codefiles/css
```

`:node` is any page using this layout; the files are shared by all of them. GET
returns `{ content }` — the starting point while the file is missing. PUT saves
`{ content }` and returns the rendered page. Both require WRITE on the global layout
page.

## Agent

Where `ai1.agent` is installed, the layout brings the agent `cms.layout.standard.2/designer`
([agents/designer.md](agents/designer.md)). It knows the template syntax and reads u2's index
online before a change. A copy in `data/cms.layout.standard.2/agents/` wins.
