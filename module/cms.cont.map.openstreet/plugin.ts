import { hee, html } from "@qino/qino";

import { geocode } from "./lib/geocode.ts";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const OSM = "https://www.openstreetmap.org";

const settingsSchema = {
  properties: {
    address: { type: "string", description: "Address of the marker, e.g. \"Hauptgasse 1, 3280 Murten\". Looked up once and remembered; lat/lon below override it." },
    lat: { type: "number", minimum: -90, maximum: 90, description: "Latitude of the marker, in decimal degrees. Leave empty to use the address." },
    lon: { type: "number", minimum: -180, maximum: 180, description: "Longitude of the marker, in decimal degrees. Leave empty to use the address." },
    zoom: { type: "integer", minimum: 1, maximum: 19, default: 16, description: "Zoom level: 12 shows a town, 16 a street, 19 a building." },
    height: { type: "integer", minimum: 8, maximum: 60, default: 22, description: "Height of the map in rem." },
  },
};

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

/** The embed wants a bounding box. One tile spans 360/2^zoom degrees of longitude; two of them
 *  make a comfortable frame, and half that in latitude roughly matches a landscape viewport. */
function bbox(lat: number, lon: number, zoom: number): string {
  const lonSpan = 360 / 2 ** zoom;
  const latSpan = lonSpan / 2;
  const box = [lon - lonSpan, lat - latSpan, lon + lonSpan, lat + latSpan];
  return box.map((n) => n.toFixed(6)).join(",");
}

/**
 * Where the marker goes. Typed coordinates win — they are the correction for a geocoder
 * that landed next door. Otherwise the address is resolved once and the answer is written
 * back into the settings, so a page view costs nothing and Nominatim sees one lookup per
 * address, as its usage policy asks. `geo.q` records which address the stored pair belongs
 * to: change the address and it is looked up again, leave it and it never is.
 */
async function position(node: Node, ctx: Ctx): Promise<{ lat: number; lon: number } | "unfound" | undefined> {
  const lat = num(node.settings.lat());
  const lon = num(node.settings.lon());
  if (lat !== undefined && lon !== undefined) return { lat, lon };

  const address = String(node.settings.address() ?? "").trim();
  if (!address) return undefined;

  const geo = node.settings.geo;
  if (String(geo.q() ?? "") === address) {
    const cachedLat = num(geo.lat());
    const cachedLon = num(geo.lon());
    if (cachedLat !== undefined && cachedLon !== undefined) return { lat: cachedLat, lon: cachedLon };
  }

  // Nominatim wants to know who is asking, and the site is the honest answer.
  const place = await geocode(address, `qino-cms/map.openstreet (+${ctx.req.url.origin})`, ctx.lang);
  if (!place) return "unfound";

  // `label` is what Nominatim thinks the address is — the only way an editor can tell a
  // marker in the wrong village from one in the right one without opening the map.
  geo({ q: address, lat: place.lat, lon: place.lon, label: place.label });
  return { lat: place.lat, lon: place.lon };
}

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const t = node.app.t;
  const found = await position(node, ctx);

  // Without a position there is nothing to show — but an editor has to learn why.
  if (found === undefined || found === "unfound") {
    if (!node.edit) return html``;
    return html.async`<div class="-empty">${
      found === "unfound"
        ? t`This address was not found. Correct it, or set latitude and longitude in the options of this content.`
        : t`Set an address, or latitude and longitude, in the options of this content.`
    }</div>`;
  }
  const { lat, lon } = found;

  const zoom = clamp(Math.round(num(node.settings.zoom()) ?? 16), 1, 19);
  const height = clamp(Math.round(num(node.settings.height()) ?? 22), 8, 60);

  const caption = await node.cms.text(node, "caption", { tag: "figcaption", if: true });
  const embed = `${OSM}/export/embed.html?bbox=${bbox(lat, lon, zoom)}&layer=mapnik&marker=${lat},${lon}`;

  // The frame is only allowed where it can actually appear.
  ctx.res.csp["frame-src"][OSM] = true;

  // The frame's `title` is its accessible name, and "Map" alone is a closed door: someone
  // who cannot see the tiles learns nothing from it. The address is what the map is about,
  // so it goes into the name — not the coordinates, which are noise to a human. `title` and
  // not `aria-description`: for an iframe the title *is* the mechanism, and aria-description
  // is still barely implemented.
  const address = String(node.settings.address() ?? "").trim();
  const title = address ? await t`Map: ${address}` : await t`Map`;

  // `loading=lazy` keeps a map further down the page from being fetched at all, and
  // `no-referrer` means openstreetmap.org does not learn which page embeds it — the IP
  // it sees anyway is all it gets.
  //
  // t`` resolves asynchronously, so the title has to be awaited before it goes into a
  // plain string — and the markup below is html.async for the same reason.
  const frame = html.raw(
    `<iframe src="${hee(embed)}" title="${hee(title)}" loading="lazy" referrerpolicy="no-referrer"` +
      ` allowfullscreen></iframe>`,
  );

  return html.async`
<figure style="--map-height:${String(height)}rem">
  ${frame}
  ${caption}
</figure>`;
}

export const cms = {
  node: {
    render,
    settingsSchema,
    css: ["pub/main.css"],
  },
};
