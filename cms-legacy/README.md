# cms-legacy

Modules that only exist so a site migrated from the PHP CMS keeps working: `page.module` holds the
old module name, and without a module of that name the page renders empty.

They are not part of a normal installation — a new site uses the current modules instead.

| legacy | current | how |
| --- | --- | --- |
| `cms.layout.custom.6` | `cms.layout.custom.9` | own shell, layout markup stays site data |
| `cms.layout.custom.7` | `cms.layout.custom.9` | own shell, layout markup stays site data |
| `cms.cont.nav2` | `cms.cont.nav3` | re-exports nav3 — same settings, same output |
| `cms.cont.section3` | — | own shell, section markup stays site data |
| `cms.cont.video.section.cd` | — | ported |
| `cms.cont.cd.boxes` | — | ported site module |
| `cms.cont.cd.services_links` | — | ported site module |
| `cms.cont.slideshow.schwups2` | — | ported slideshow shell and behavior |
| `cms.cont.gallery.photoswipe1` | — | ported gallery shell with PhotoSwipe assets |
| `cms.legacy.c1` | — | browser helpers shared by legacy site modules |

A module belongs here when the old name has to survive. Where a rename is all that differs,
rewriting `page.module` during the migration is the cheaper answer.

`lib/bg.ts` replaces PHP's `cms_image2_bg()`: qino's `cms.image2` only ports the foreground
`<cms-image2>`, so a background image is plain CSS here — same picture, no lazy upgrade.
