import { html } from "@qino/qino";
import { instant, isDate } from "@qino/qino/calendar";
import { cmsCtx } from "@qino/qino/cms";
import { get, list, zoneOf } from "@qino/qino/cms.event";
import { jsonLd } from "@qino/qino/seo";

import api from "./nodeApi.ts";
import { formatDates } from "./dates.ts";
import { answer, PARAM, place } from "./feed.ts";

import type { Ctx, Row } from "@qino/qino";
import type { Range } from "@qino/qino/calendar";
import type { Node } from "@qino/qino/cms";

async function render(node: Node, { ctx }: { ctx: Ctx }) {
  await answer(ctx, node, async () => [node]);
  const t = node.app.t.in("cms.cont.event");
  const event = await get(node) ?? {}, dates = await list(node), zone = await zoneOf(node.app, event);
  if (cmsCtx(ctx).requestedNode?.id === node.id) await structured(node, ctx, event, dates, zone);
  // what is stored is checked (cms.event set()): codes, language and link are valid or empty
  const location = await node.cms.text(node, "location", { if: true });
  const address = [event.address_street, [event.address_postal_code, event.address_locality].filter(Boolean).join(" "), event.address_country].filter(Boolean);
  const price = event.price == null ? "" : new Intl.NumberFormat(ctx.lang, event.currency ? { style: "currency", currency: String(event.currency) } : {}).format(Number(event.price));
  const facts = [
    location || address.length ? html.async`<dt>${t`Location`}</dt><dd>${location}${address.length ? html`<div>${address.map((line) => html`<div>${line}</div>`)}</div>` : ""}</dd>` : "",
    price ? html.async`<dt>${t`Price`}</dt><dd>${price}</dd>` : "",
    event.performer ? html.async`<dt>${t`Instructors / performers`}</dt><dd>${event.performer}</dd>` : "",
    event.language ? html.async`<dt>${t`Event language`}</dt><dd>${new Intl.DisplayNames(ctx.lang, { type: "language" }).of(String(event.language))}</dd>` : "",
  ].filter(Boolean);
  return html.async`<article>
    ${node.cms.text(node, "title", { tag: "h2" })}
    ${dates.length ? html`<ul>${formatDates(dates, ctx.lang, zone).map((date) => html`<li>${date}</li>`)}</ul>` : ""}
    ${facts.length ? html.async`<dl>${facts}</dl>` : ""}
    ${node.cms.text(node, "main")}
    ${dates.length ? html.async`<p><a href="?${PARAM}=${node.id}" rel=nofollow download>${t`Add to calendar`}</a></p>` : ""}
    ${event.external_link ? html.async`<p><a href="${event.external_link}">${t`External event page`}</a></p>` : ""}
  </article>`;
}

/** schema.org Event, one per date: what search engines show as event results. */
async function structured(node: Node, ctx: Ctx, event: Row, dates: Range[], zone: string) {
  const venue = await place(node, event);
  const url = new URL(await node.url(), ctx.req.url.href).href, name = (await node.showTitle()).plain();
  const description = (await node.showText("main")).plain().slice(0, 500);
  // dates stay dates; times keep the offset of the event's zone
  const time = (value: string) => isDate(value) ? value : instant(value).toZonedDateTimeISO(zone).toString({ timeZoneName: "never", smallestUnit: "second" });
  const performer = String(event.performer ?? "");
  for (const date of dates) jsonLd(ctx, {
    "@type": "Event", name, url, ...(description && { description }),
    startDate: time(date.start), ...(date.end !== date.start && { endDate: time(isDate(date.end) ? Temporal.PlainDate.from(date.end).subtract({ days: 1 }).toString() : date.end) }),
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    ...((venue.name || venue.locality) && { location: { "@type": "Place", name: venue.name || venue.locality, address: {
      "@type": "PostalAddress", streetAddress: venue.street, addressLocality: event.address_locality ?? "",
      postalCode: event.address_postal_code ?? "", addressCountry: venue.country,
    } } }),
    ...(event.price != null && event.currency && { offers: { "@type": "Offer", price: String(event.price), priceCurrency: event.currency, url } }),
    ...(performer && { performer: performer.split(/\s*,\s*/).map((p) => ({ "@type": "Person", name: p })) }),
    ...(event.language && { inLanguage: event.language }),
  });
}

export const cms = { node: { render, api, is: ["cms_event"], widget: "pub/widget.js" } };
