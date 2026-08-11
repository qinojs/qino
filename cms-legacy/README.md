# cms-legacy

Modules that only exist so a site migrated from the PHP CMS keeps working: `page.module` holds the
old module name, and without a module of that name the page renders empty.

They are not part of a normal installation — a new site uses the current modules instead.

| legacy | current | how |
| --- | --- | --- |
| `cms.layout.custom.3` | `cms.layout.custom.9` | own shell, layout markup stays site data |
| `cms.layout.custom.6` | `cms.layout.custom.9` | own shell, layout markup stays site data |
| `cms.layout.custom.7` | `cms.layout.custom.9` | own shell, layout markup stays site data |
| `cms.cont.nav2` | `cms.cont.nav3` | re-exports nav3 — same settings, same output |
| `cms.cont.section3` | — | own shell, section markup stays site data |
| `cms.cont.video.section.cd` | — | ported |
| `cms.cont.cd.boxes` | — | ported site module |
| `cms.cont.cd.services_links` | — | ported site module |
| `cms.cont.cd.link_box` | — | ported site module |
| `cms.cont.cd.fullscreen` | — | ported section with two headings |
| `cms.cont.cd.text` | — | ported text section |
| `cms.cont.cd.2_bilder` | — | ported pair of linked images |
| `cms.cont.cd.image_height` | — | ported single-image section |
| `cms.cont.cd.slideshow` | — | ported slideshow with per-slide texts |
| `cms.cont.icons1` | — | ported icon row |
| `cms.cont.stretchedItems1` | — | ported column layout |
| `cms.cont.slideshow.schwups2` | — | ported slideshow shell and behavior |
| `cms.cont.gallery.photoswipe1` | — | ported gallery shell with PhotoSwipe assets |
| `cms.cont.images.cd` | — | ported linked image row |
| `cms.cont.product_overview.cd` | — | ported product overview shell |
| `cms.cont.quote.cd` | — | site-template wrapper for quotes |
| `cms.cont.shp3.currency_chooser` | — | ported currency chooser behavior |
| `cms.cont.text_and_slider.cd` | — | ported text and image slider |
| `cms.cont.cols2` | — | ported responsive column layout |
| `cms.cont.spacer` | — | ported spacing element |
| `cms.cont.parallax2` | — | ported parallax section shell |
| `cms.cont.video.nativ1` | — | ported native video player |
| `cms.cont.video.youtube2` | — | ported privacy-aware YouTube embed |
| `cms.cont.overview.cd` | — | ported linked page overview |
| `cms.cont.privacy_policy1` | — | ported generated privacy policy |
| `cms.cont.impressum2` | — | ported generated imprint |
| `cms.cont.cd.fullcalendar` | — | ported accessible event list |
| `cms.cont.event2.category3` | — | ported event-category read view |
| `cms.cont.event2.default` | — | ported event-detail read view; registration intentionally disabled |
| `cms.cont.event2.fullcalendar4` | — | ported accessible calendar read view |
| `cms.cont.event2.overview1` | — | ported upcoming/past event overview |
| `cms.cont.navigation.horizontal` | — | ported active-branch navigation |
| `cms.cont.freePosition1` | — | ported positioned content container |
| `cms.cont.slider.nivoSlider` | — | ported dependency-free image slider |
| `cms.legacy.c1` | — | browser helpers shared by legacy site modules |

A module belongs here when the old name has to survive. Where a rename is all that differs,
rewriting `page.module` during the migration is the cheaper answer.

A ported module brings the CSS of its PHP original along. `migrateCss` rewrites the site's own
files under `data/`: module and node classes become `[qcms-mod="…"]` and `[qcms-id="…"]`, while
absolute `/qg/<module>/` asset paths become relative to the CSS file. Store files stay untouched.

`lib/bg.ts` replaces PHP's `cms_image2_bg()`: qino's `cms.image2` only ports the foreground
`<cms-image2>`, so a background image is plain CSS here — same picture, no lazy upgrade.
`sectionAttr()` adds what every legacy section shared: the `background-color` setting and white text
once that colour is dark. `lib/text.ts` is PHP's `cms_text()`, `lib/siteTemplate.ts` loads the
site's own `data/<module>/index.ts`.
