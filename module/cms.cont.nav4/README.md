# cms.cont.nav4

Server-rendered navigation from the CMS tree. Outputs one `nav` with nested
`ul`, `li` and ordinary CMS links. No CSS, JavaScript or u2 dependency: the layout
styles the lists; optional browser behavior can enhance them without replacing links.

The current rendered page determines the active entry and path. By default the
navigation starts at its tree root and lists visible, readable pages with a
nonempty displayed title. A hidden or unreadable branch is skipped, not promoted.
Offline pages may appear in edit mode according to the existing CMS access rules.

Global navigation works on a layout page: its system location does not determine
the default start. A site living below a particular subtree sets `startPage`.

| setting | behavior |
|---|---|
| `startPage` | Parent of the entries; missing or invalid targets fall back to the current tree root |
| `startLevel` | Absolute level in the current page's path; 0 is the root; overrides startPage; out-of-range falls back to root |
| `filter_visible` | `visible` by default, `hidden` for hidden pages, empty for all readable pages |
| `level` | Number of list levels; 1 lists immediate children; empty or 0 is unlimited |
| `pathOnly` | Expand sub-levels only along the current path; false by default |
| `include contents` | Add visible, readable content anchors, in their existing tree order |

The start page itself is not an entry. Content anchors stay leaves and do not
inherit the active state of their containing page. URLs, language, target,
editable labels and `aria-current=page` come from `CMS.link()`.

Existing hooks: `cmsInside` marks entries on the current path, `cmsActive` the
current page, `cmsHasSub` a nonempty rendered sublist, `cmsOffline` an offline
entry. `cmsLink<ID>` and `cmsChilds<ID>` remain available; generic layout styles
should use list relationships and state classes instead of specific IDs.

## Initial settings

`Node.cont()` already uses its second argument only when creating the named
content. Currently the database settings field expects JSON text:

```ts
const nav = await layoutPage.cont("nav", {
  module: "cms.cont.nav4",
  settings: JSON.stringify({ startPage: section.id, level: 2 }),
});
```

Subsequent calls preserve the content's module and settings. Changing these
creation defaults does not change an existing navigation. The templateParser's
`cms-cont` currently accepts the module name, not an initial settings object.
