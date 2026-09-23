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

/** Bounding box for the embed: two tiles (360/2^zoom degrees each) wide, half that high. */
function bbox(lat: number, lon: number, zoom: number): string {
  const lonSpan = 360 / 2 ** zoom;
  const latSpan = lonSpan / 2;
  const box = [lon - lonSpan, lat - latSpan, lon + lonSpan, lat + latSpan];
  return box.map((n) => n.toFixed(6)).join(",");
}

/**
 * Marker position. Typed coordinates win (to correct a wrong result). Otherwise the address is
 * looked up once and stored in the settings (`geo.q` = the address it belongs to), so page views
 * cost nothing and Nominatim gets one lookup per address.
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

  // `label`: Nominatim's reading of the address, so editors can spot a wrong result.
  geo({ q: address, lat: place.lat, lon: place.lon, label: place.label });
  return { lat: place.lat, lon: place.lon };
}

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const t = node.app.t;
  const found = await position(node, ctx);

  // Without a position there is nothing to show — but an editor has to learn why.
  if (found === undefined || found === "unfound") {
    if (!await node.edit()) return html``;
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

  // The iframe's `title` is its accessible name, so include the address (not the coordinates).
  // Not `aria-description`: barely supported.
  const address = String(node.settings.address() ?? "").trim();
  const title = address ? await t`Map: ${address}` : await t`Map`;

  // `loading=lazy`: load only when scrolled into view. `no-referrer`: openstreetmap.org doesn't
  // learn the embedding page.
  //
  // t`` is async, so the title is awaited, and the markup is html.async.
  const frame = html.raw(
    `<iframe src="${hee(embed)}" title="${hee(title)}" loading="lazy" referrerpolicy="no-referrer"` +
      ` allowfullscreen></iframe>`,
  );

  return html.async`
<figure style="--map-height:${height}rem">
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
