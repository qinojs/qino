import { html } from "@qino/qino";
import { instant, isDate } from "@qino/qino/calendar";
import { cmsCtx } from "@qino/qino/cms";
import { get, list, titled, zoneOf } from "@qino/qino/cms.event";
import { jsonLd } from "@qino/qino/seo";

import api from "./nodeApi.ts";
import { formatDates, statusText } from "./dates.ts";
import { answer, feedUrl, organizer, place } from "./feed.ts";

import type { Ctx, Row } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const STATUS = { cancelled: "EventCancelled", postponed: "EventPostponed", rescheduled: "EventRescheduled" } as Record<string, string>;

async function render(node: Node, { ctx }: { ctx: Ctx }) {
  await answer(ctx, node, async () => [node]);
  const t = node.app.t.in("cms.cont.event");
  const event = await get(node) ?? {}, dates = await list(node), zone = await zoneOf(node.app, event);
  if (cmsCtx(ctx).requestedNode?.id === node.id) await structured(node, ctx, event, dates, zone);
  // what is stored is checked (cms.event set()): codes, language and links are valid or empty
  const money = (value: unknown) => new Intl.NumberFormat(ctx.lang, event.currency ? { style: "currency", currency: String(event.currency) } : {}).format(Number(value));
  const location = await node.cms.text(node, "location", { if: true });
  const address = [event.address_street, [event.address_postal_code, event.address_locality].filter(Boolean).join(" "), event.address_country].filter(Boolean);
  const status = statusText(node.app, event.status);
  const facts = [
    location || address.length ? html.async`<dt>${t`Location`}</dt><dd>${location}${address.length ? html`<div>${address.map((line) => html`<div>${line}</div>`)}</div>` : ""}</dd>` : "",
    event.online_url ? html.async`<dt>${t`Online`}</dt><dd><a href="${event.online_url}">${t`Take part online`}</a></dd>` : "",
    event.price != null ? html.async`<dt>${t`Price`}</dt><dd>${money(event.price)}</dd>` : "",
    event.performer ? html.async`<dt>${t`Instructors / performers`}</dt><dd>${event.performer}</dd>` : "",
    event.language ? html.async`<dt>${t`Event language`}</dt><dd>${new Intl.DisplayNames(ctx.lang, { type: "language" }).of(String(event.language))}</dd>` : "",
  ].filter(Boolean);
  const times = formatDates(dates, ctx.lang, zone);
  return html.async`<article>
    ${node.cms.text(node, "title", { tag: "h2" })}
    ${status ? html.async`<p><strong>${status}</strong></p>` : ""}
    ${dates.length ? html`<ul>${dates.map((date, i) => html`<li>${times[i]}${date.price != null ? ` · ${money(date.price)}` : ""}</li>`)}</ul>` : ""}
    ${facts.length ? html.async`<dl>${facts}</dl>` : ""}
    ${node.cms.text(node, "main")}
    ${dates.length ? html.async`<p><a href="${feedUrl(ctx, node)}" rel=nofollow download>${t`Add to calendar`}</a></p>` : ""}
    ${event.external_link ? html.async`<p><a href="${event.external_link}">${t`External event page`}</a></p>` : ""}
  </article>`;
}

/** schema.org Event, one per date: what search engines show as event results. */
async function structured(node: Node, ctx: Ctx, event: Row, dates: Awaited<ReturnType<typeof list>>, zone: string) {
  const venue = await place(node, event), holder = await organizer(node);
  const url = new URL(await node.url(), ctx.req.url.href).href, name = (await node.showTitle()).plain();
  const description = (await node.showText("main")).plain().slice(0, 500);
  // dates stay dates; times keep the offset of the event's zone
  const time = (value: string) => isDate(value) ? value : instant(value).toZonedDateTimeISO(zone).toString({ timeZoneName: "never", smallestUnit: "second" });
  const physical = venue.name || venue.locality ? { "@type": "Place", name: venue.name || venue.locality, address: {
    "@type": "PostalAddress", streetAddress: venue.street, addressLocality: event.address_locality ?? "",
    postalCode: event.address_postal_code ?? "", addressCountry: venue.country,
  } } : undefined;
  const online = event.online_url ? { "@type": "VirtualLocation", url: event.online_url } : undefined;
  const mode = physical && online ? "Mixed" : online ? "Online" : "Offline";
  for (const date of dates) {
    const price = date.price ?? event.price;
    jsonLd(ctx, {
      "@type": "Event", name: titled(name, date), url, ...(description && { description }),
      startDate: time(date.start), ...(date.end !== date.start && { endDate: time(isDate(date.end) ? Temporal.PlainDate.from(date.end).subtract({ days: 1 }).toString() : date.end) }),
      eventStatus: `https://schema.org/${STATUS[String(event.status)] ?? "EventScheduled"}`,
      eventAttendanceMode: `https://schema.org/${mode}EventAttendanceMode`,
      ...((physical || online) && { location: physical && online ? [physical, online] : physical ?? online }),
      ...(price != null && event.currency && { offers: { "@type": "Offer", price: String(price), priceCurrency: event.currency, url } }),
      ...(event.performer && { performer: String(event.performer).split(/\s*,\s*/).map((name) => ({ "@type": "Person", name })) }),
      ...(holder.name && { organizer: { "@type": "Organization", name: holder.name, url: new URL(ctx.req.appUrl, ctx.req.url.href).href } }),
      ...(event.language && { inLanguage: event.language }),
    });
  }
}

export const cms = { node: { render, api, is: ["cms_event"], widget: "pub/widget.js" } };
