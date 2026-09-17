# seo

Serves `robots.txt` and `sitemap.xml` below the app URL. Both answers are cached per app and
host for one hour, so changes show up with that delay.

`robots.txt` allows everything and points to the sitemap. The sitemap has no own content:
modules add absolute URLs through `seo:sitemap`. `cms` adds its public pages.

```ts
app.on("seo:sitemap", ({ base, urls }) => {
  urls.push(base + "shop/");
}, { signal });
```
