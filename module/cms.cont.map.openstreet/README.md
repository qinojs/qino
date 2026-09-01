# cms.cont.map.openstreet

A map, from [OpenStreetMap](https://www.openstreetmap.org). No account, no API key,
no billing. Give it an address and it finds the place itself.

## What the frame gives away

The map is an `<iframe>` and nothing more, so openstreetmap.org learns what any server
learns from a request: the visitor's IP address, their user-agent and language, and the
time. It cannot read the page around it — cross-origin is cross-origin — and
`referrerpolicy="no-referrer"` keeps it from learning which page embeds it at all. The
OSM Foundation runs no ad business and sets no tracking cookies.

That is the whole exposure, and it is why the frame is simply there: an interstitial
"show map" button buys a visitor almost nothing and costs everyone a click. What it does
buy is spent elsewhere — `loading="lazy"` means a map below the fold is never fetched
for someone who does not scroll to it.

## Settings

Per content, in its options panel:

| setting   | meaning                                                          |
|-----------|------------------------------------------------------------------|
| `address` | address of the marker, e.g. `Hauptgasse 1, 3280 Murten`           |
| `lat`     | latitude of the marker, decimal degrees                           |
| `lon`     | longitude of the marker, decimal degrees                          |
| `zoom`    | 12 shows a town, 16 a street, 19 a building (default 16)          |
| `height`  | height of the map in rem (default 22)                             |

Without a position the content renders nothing for visitors, and a note for editors —
a map at the wrong place is worse than none.

## Address or coordinates

The map itself only ever speaks coordinates; there is no OpenStreetMap parameter that
takes an address. So an address typed into `address` is resolved once, by
[Nominatim](https://nominatim.org), and the answer is written back into the content's
settings under `geo`:

```json
"geo": { "q": "Hauptgasse 1, 3280 Murten", "lat": 46.9284, "lon": 7.1147, "label": "…" }
```

`geo.q` records which address that pair belongs to. Change the address and it is looked
up again; leave it and it never is — a page view costs nothing and openstreetmap.org sees
one request per address, which is what Nominatim's usage policy asks for. Requests are
serialised a second apart and carry the site's own user-agent, an address that comes back
empty is not retried for an hour, and the same address asked for by several requests at
once is looked up once. `geo.label` is Nominatim's own reading of the address — the way to
tell a marker in the wrong village from one in the right one without opening the map.

`lat`/`lon`, when both are set, win over all of this. They are the correction for a
geocoder that landed next door, and the way to place a marker where no address exists.

One text, translated like any other cms text and hidden while empty: `caption`, under
the map. It is an offer, not an obligation — an empty caption renders no `<figcaption>`
at all, and the map does not depend on it.

The frame is named for the address instead: `title="Map: Hauptgasse 1, 3280 Murten"`,
which is what a screenreader announces when it reaches the frame — "Map" alone would be
a closed door, and the coordinates are noise to a human. Without an address the title
falls back to "Map". `title`, not `aria-description`: for an iframe the title *is* the
accessible name, and `aria-description` is still barely implemented anywhere.

## What it renders

```html
<figure qcms-mod="cont.map.openstreet" style="--map-height:22rem">
  <iframe src="…/export/embed.html?bbox=…&marker=…" title="Map"
          loading="lazy" referrerpolicy="no-referrer" allowfullscreen></iframe>
</figure>
```

No JavaScript of its own. `frame-src` for openstreetmap.org is added to the response's
CSP by the module itself, and only where a map is actually on the page.

## Ideas, not built

- **The identity address.** `address` is typed in. A map showing the organisation's own
  address could take it from the [identity](../identity/) module instead of repeating it.
- **Lookup at edit time.** The address is resolved during the first render that needs it,
  which makes that one request a little slower and leaves the editor to find a bad address
  by looking at the page. A lookup when the setting is saved would say so on the spot.
- **Own tiles.** `layer=mapnik` uses the OSM Foundation's tiles, whose usage policy is
  meant for modest traffic. A busy site should point the embed at its own tile server.
