# cms.cont.map.openstreet

A map from [OpenStreetMap](https://www.openstreetmap.org). No account, no API key, no cost.
Enter an address and it finds the place.

## What the frame gives away

The map is a plain `<iframe>`, so openstreetmap.org sees what any server sees: IP address,
user-agent, language and time. It cannot read the page, and `referrerpolicy="no-referrer"` hides
which page embeds it. The OSM Foundation sets no tracking cookies.

So there is no "show map" button — it would protect almost nothing and cost every visitor a click.
`loading="lazy"` means the map is only loaded when scrolled into view.

## Settings

Per content, in its options panel:

| setting   | meaning                                                          |
|-----------|------------------------------------------------------------------|
| `address` | address of the marker, e.g. `Hauptgasse 1, 3280 Murten`           |
| `lat`     | latitude of the marker, decimal degrees                           |
| `lon`     | longitude of the marker, decimal degrees                          |
| `zoom`    | 12 shows a town, 16 a street, 19 a building (default 16)          |
| `height`  | height of the map in rem (default 22)                             |

Without a position, visitors see nothing and editors a note — a wrong map is worse than none.

## Address or coordinates

The embed only takes coordinates. So `address` is looked up once via
[Nominatim](https://nominatim.org), and the result is saved in the settings under `geo`:

```json
"geo": { "q": "Hauptgasse 1, 3280 Murten", "lat": 46.9284, "lon": 7.1147, "label": "…" }
```

`geo.q` stores which address the coordinates belong to. Only a changed address is looked up
again, so page views cost nothing and Nominatim gets one request per address, as its usage policy
asks. Requests are sent one second apart with the site's user-agent; an address without result is
not retried for an hour; parallel requests for the same address are looked up once. `geo.label` is
Nominatim's reading of the address — to spot a marker in the wrong village without opening the map.

`lat`/`lon`, when both set, win — to correct a wrong result or place a marker without an address.

Optional text `caption` below the map, translatable like any cms text; if empty, no `<figcaption>`
is rendered.

The frame's `title` names the address (`title="Map: Hauptgasse 1, 3280 Murten"`), which screen
readers announce; without an address it is "Map". `title`, not `aria-description`: for an iframe
the title is the accessible name, and `aria-description` is barely supported.

## What it renders

```html
<figure qcms-mod="cont.map.openstreet" style="--map-height:22rem">
  <iframe src="…/export/embed.html?bbox=…&marker=…" title="Map"
          loading="lazy" referrerpolicy="no-referrer" allowfullscreen></iframe>
</figure>
```

No JavaScript. The module adds `frame-src` for openstreetmap.org to the CSP, only on pages with a
map.

## Ideas, not built

- **Identity address.** Take the address from [identity](../identity/) instead of typing it again.
- **Lookup on save.** Today the first render looks it up (slightly slower, and the editor only sees
  a bad address on the page). Looking up when saving would report it right away.
- **Own tiles.** `layer=mapnik` uses OSM Foundation tiles, meant for modest traffic. Busy sites
  should use their own tile server.
