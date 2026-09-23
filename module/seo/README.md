# seo

Serves `robots.txt` and `sitemap.xml` below the app URL. Both answers are cached per app and
host for one hour, so changes show up with that delay.

`robots.txt` allows everything and points to the sitemap; modules add rules via `seo:robots`.
Modules add absolute URLs to the sitemap via `seo:sitemap`, as a string or
`{ url, lastmod?, image? }`. `url` may map languages to one page's versions (hreflang alternates);
`lastmod` is a unix time, `image` an absolute URL. `cms` adds its public pages with their last
change and the page file `main` as image.

```ts
app.on("seo:robots", ({ ctx, lines }) => {
  lines.push(`Disallow: ${ctx.req.appUrl}intern/`);
}, { signal });

app.on("seo:sitemap", ({ base, urls }) => {
  urls.push(base + "shop/");
  urls.push({ url: { en: base + "en/about", de: base + "de/ueber-uns" }, lastmod: 1726560000, image: base + "img/about.jpg" });
}, { signal });
```
