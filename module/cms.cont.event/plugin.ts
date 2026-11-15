import { html } from "@qino/qino";
import { instant, isDate } from "@qino/qino/calendar";
import { cmsCtx } from "@qino/qino/cms";
import { list, zoneOf } from "@qino/qino/cms.event";
import { jsonLd } from "@qino/qino/seo";

import api from "./nodeApi.ts";
import { formatDates } from "./dates.ts";
import { answer, PARAM, place } from "./feed.ts";

import type { Ctx } from "@qino/qino";
import type { Range } from "@qino/qino/calendar";
import type { Node } from "@qino/qino/cms";

/** Settings are free text, and Intl throws on a code it cannot read. */
function intl(format: () => string | undefined) {
  try { return format(); } catch { return ""; }
}

async function render(node: Node, { ctx }: { ctx: Ctx }) {
  await answer(ctx, node, async () => [node]);
  const t = node.app.t.in("cms.cont.event"), settings = node.settings;
  const blocks = await list(node);
  if (cmsCtx(ctx).requestedNode?.id === node.id) await structured(node, ctx, blocks);
  const location = await node.cms.text(node, "location", { if: true });
  const address = [settings.address_street(), [settings.address_postal_code(), settings.address_locality()].filter(Boolean).join(" "), settings.address_country()].filter(Boolean);
  const price = settings.price(), performer = settings.performer();
  const amount = price == null || price === "" ? "" : intl(() => new Intl.NumberFormat(ctx.lang, { style: "currency", currency: String(settings.currency()) }).format(Number(price)));
  const language = intl(() => new Intl.DisplayNames(ctx.lang, { type: "language" }).of(String(settings.language() || "-")));
  const link = /^https?:\/\//i.test(settings.external_link() ?? "") ? settings.external_link() : "";
  const facts = [
    location || address.length ? html.async`<dt>${t`Location`}</dt><dd>${location}${address.length ? html`<div>${address.map((line) => html`<div>${line}</div>`)}</div>` : ""}</dd>` : "",
    amount ? html.async`<dt>${t`Price`}</dt><dd>${amount}</dd>` : "",
    performer ? html.async`<dt>${t`Instructors / performers`}</dt><dd>${performer}</dd>` : "",
    language ? html.async`<dt>${t`Event language`}</dt><dd>${language}</dd>` : "",
  ].filter(Boolean);
  return html.async`<article>
    ${node.cms.text(node, "title", { tag: "h2" })}
    ${blocks.length ? html`<ul>${formatDates(blocks, ctx.lang, await zoneOf(node)).map((date) => html`<li>${date}</li>`)}</ul>` : ""}
    ${facts.length ? html.async`<dl>${facts}</dl>` : ""}
    ${node.cms.text(node, "main")}
    ${blocks.length ? html.async`<p><a href="?${PARAM}=${node.id}" rel=nofollow download>${t`Add to calendar`}</a></p>` : ""}
    ${link ? html.async`<p><a href="${link}">${t`External event page`}</a></p>` : ""}
  </article>`;
}

/** schema.org Event, one per date: what search engines show as event results. */
async function structured(node: Node, ctx: Ctx, blocks: Range[]) {
  const s = node.settings, zone = await zoneOf(node), venue = await place(node);
  const url = new URL(await node.url(), ctx.req.url.href).href, name = (await node.showTitle()).plain();
  const description = (await node.showText("main")).plain().slice(0, 500);
  // dates stay dates; times keep the offset of the event's zone
  const time = (value: string) => isDate(value) ? value : instant(value).toZonedDateTimeISO(zone).toString({ timeZoneName: "never", smallestUnit: "second" });
  const price = s.price(), currency = String(s.currency() ?? "").toUpperCase();
  const performer = String(s.performer() ?? ""), language = String(s.language() ?? "");
  for (const block of blocks) jsonLd(ctx, {
    "@type": "Event", name, url, ...(description && { description }),
    startDate: time(block.start), ...(block.end !== block.start && { endDate: time(isDate(block.end) ? Temporal.PlainDate.from(block.end).subtract({ days: 1 }).toString() : block.end) }),
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    ...((venue.name || venue.locality) && { location: { "@type": "Place", name: venue.name || venue.locality, address: {
      "@type": "PostalAddress", streetAddress: venue.street, addressLocality: s.address_locality() ?? "",
      postalCode: s.address_postal_code() ?? "", addressCountry: venue.country,
    } } }),
    ...(price != null && price !== "" && /^[A-Z]{3}$/.test(currency) && { offers: { "@type": "Offer", price: String(price), priceCurrency: currency, url } }),
    ...(performer && { performer: performer.split(/\s*,\s*/).map((p) => ({ "@type": "Person", name: p })) }),
    ...(language && { inLanguage: language }),
  });
}

export const cms = { node: {
  render, api, widget: "pub/widget.js",
  settingsSchema: { properties: {
    time_zone: { type: "string", description: "IANA time zone for event display and local time input; unset: the default of cms.event." },
    address_street: { type: "string", description: "Venue street address." },
    address_postal_code: { type: "string", description: "Venue postal code." },
    address_locality: { type: "string", description: "Venue city or locality." },
    address_country: { type: "string", description: "Venue country, ISO 3166-1 alpha-2." },
    price: { type: ["number", "string", "null"], minimum: 0, description: "Displayed admission or course price; zero means free, unset means no price information." },
    currency: { type: "string", description: "Price currency, ISO 4217. Without a valid one the price is not shown." },
    performer: { type: "string", description: "Names of instructors, speakers or performers; not linked to private user records." },
    language: { type: "string", description: "Event language as a BCP 47 language tag, independent of the page language." },
    external_link: { type: "string", description: "Optional HTTP(S) URL for the external event page or registration." },
  } },
} };
