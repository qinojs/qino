import { html } from "@qino/qino";
import { list } from "@qino/qino/cms.event";

import api from "./nodeApi.ts";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

async function render(node: Node, { ctx }: { ctx: Ctx }) {
  const t = node.app.t.in("cms.cont.event");
  const timeZone = String(node.settings.time_zone() ?? "UTC");
  const settings = node.settings;
  const blocks = await list(node);
  const location = await node.cms.text(node, "location", { if: true });
  const dates = new Intl.DateTimeFormat(ctx.lang, { dateStyle: "long", timeZone: "UTC" });
  const times = new Intl.DateTimeFormat(ctx.lang, { dateStyle: "long", timeStyle: "short", timeZone });
  const address = [settings.address_street(), [settings.address_postal_code(), settings.address_locality()].filter(Boolean).join(" "), settings.address_country()].filter(Boolean);
  const price = settings.price();
  const currency = String(settings.currency() ?? "");
  const language = String(settings.language() ?? "");
  const performer = String(settings.performer() ?? "");
  const external = String(settings.external_link() ?? "");
  const link = /^https?:\/\//i.test(external) ? external : "";
  const facts = [
    location || address.length ? html.async`<dt>${t`Location`}</dt><dd>${location}${address.length ? html`<div>${address.map((line) => html`<div>${line}</div>`)}</div>` : ""}</dd>` : "",
    price != null && price !== "" && currency ? html.async`<dt>${t`Price`}</dt><dd>${new Intl.NumberFormat(ctx.lang, { style: "currency", currency }).format(Number(price))}</dd>` : "",
    performer ? html.async`<dt>${t`Instructors / performers`}</dt><dd>${performer}</dd>` : "",
    language ? html.async`<dt>${t`Event language`}</dt><dd>${new Intl.DisplayNames(ctx.lang, { type: "language" }).of(language)}</dd>` : "",
  ].filter(Boolean);
  return html.async`<article>
    ${node.cms.text(node, "title", { tag: "h2" })}
    ${blocks.length ? html.async`<ul>${blocks.map((block) => {
      const allDay = !/[Tt ]/.test(block.start);
      const end = allDay ? Temporal.PlainDate.from(block.end).subtract({ days: 1 }).toString() : block.end;
      const instant = (value: string) => allDay ? Temporal.PlainDate.from(value).toZonedDateTime("UTC").epochMilliseconds
        : Temporal.Instant.from(value).epochMilliseconds;
      return html`<li><time datetime="${block.start}">${(allDay ? dates : times).formatRange(instant(block.start), instant(end))}</time></li>`;
    })}</ul>` : ""}
    ${facts.length ? html.async`<dl>${facts}</dl>` : ""}
    ${node.cms.text(node, "main")}
    ${link ? html.async`<p><a href="${link}">${t`External event page`}</a></p>` : ""}
  </article>`;
}

export const cms = { node: {
  render, api, widget: "pub/widget.js",
  settingsSchema: { properties: {
    time_zone: { type: "string", default: "UTC", description: "IANA time zone for event display and local time input." },
    address_street: { type: "string", description: "Venue street address." },
    address_postal_code: { type: "string", description: "Venue postal code." },
    address_locality: { type: "string", description: "Venue city or locality." },
    address_country: { type: "string", description: "Venue country, ISO 3166-1 alpha-2." },
    price: { type: ["number", "null"], minimum: 0, description: "Displayed admission or course price; zero means free, unset means no price information." },
    currency: { type: "string", description: "Price currency, ISO 4217. Required when a price is given." },
    performer: { type: "string", description: "Names of instructors, speakers or performers; not linked to private user records." },
    language: { type: "string", description: "Event language as a BCP 47 language tag, independent of the page language." },
    external_link: { type: "string", description: "Optional HTTP(S) URL for the external event page or registration." },
  } },
} };
