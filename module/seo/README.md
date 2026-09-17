# seo

Serves `robots.txt` and `sitemap.xml` below the app URL. Both answers are cached per app and
host for one hour, so changes show up with that delay.

`robots.txt` allows everything and points to the sitemap; modules add rules through
`seo:robots`. The sitemap has no own content: modules add absolute URLs through `seo:sitemap`,
either as a string or as `{ url, lastmod?, image? }`. `url` may map languages to the versions of one page, which become
hreflang alternates; `lastmod` is a unix time, `image` an absolute image URL. `cms` adds its
public pages, dated by their last change, with the page file `main` as image.

```ts
app.on("seo:robots", ({ ctx, lines }) => {
  lines.push(`Disallow: ${ctx.req.appUrl}intern/`);
}, { signal });

app.on("seo:sitemap", ({ base, urls }) => {
  urls.push(base + "shop/");
  urls.push({ url: { en: base + "en/about", de: base + "de/ueber-uns" }, lastmod: 1726560000, image: base + "img/about.jpg" });
}, { signal });
```
