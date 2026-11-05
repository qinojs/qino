# cms.seo

Adds the public, searchable pages to the `seo` sitemap, with their last change and image.

Sets the tags for shared links: `og:title`, `og:description`, `og:image` and `twitter:card`. Each
takes the page's own value, else what a layout or module set, else the default:

| Tag | Page's own value | Default |
|---|---|---|
| `og:title` | text `_share_title` | the page's `<title>` |
| `og:description` | text `_share_description` | the description (`_description`) |
| `og:image` | file `share`, else `main` | none |

A layout sets a site-wide image with `ctx.res.html.meta["og:image"]`. Editors fill the share
values below the panel's SEO widget.
