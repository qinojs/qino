import { html, type Ctx, type HtmlString } from "../../module/core/mod.ts";
import type { Node } from "../../module/cms/mod.ts";
import { eventDate, eventDates, eventInfo, eventPerformers } from "../lib/event2.ts";
import { cmsText } from "../lib/text.ts";

const words = (lang: string) => lang === "de"
  ? { dates: "Datum", location: "Ort", price: "Preis", performers: "Leitung" }
  : { dates: "Date", location: "Location", price: "Price", performers: "Teachers" };

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const parent = await node.parent();
  const info = await eventInfo(node);
  const dates = await eventDates(node);
  const performers = await eventPerformers(node);
  const labels = words(ctx.lang);
  const date = new Intl.DateTimeFormat(ctx.lang, { dateStyle: "long", timeStyle: "short" });
  const facts: HtmlString[] = [];

  if (dates.length) {
    const value = dates.map((row) => {
      const start = eventDate(row.start_date);
      const end = eventDate(row.end_date);
      if (Number.isNaN(+start)) return "";
      const from = row.all_day ? new Intl.DateTimeFormat(ctx.lang, { dateStyle: "long" }).format(start) : date.format(start);
      return !Number.isNaN(+end) && +end !== +start ? `${from} – ${date.format(end)}` : from;
    }).filter(Boolean).join("<br>");
    facts.push(html`<dt>${labels.dates}</dt><dd>${html.raw(value)}</dd>`);
  }
  const location = String(await node.showText("location"));
  const address = [info.address_street, [info.address_postal_code, info.address_locality].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  if (location || address) facts.push(html`<dt>${labels.location}</dt><dd>${html.raw(location)}${location && address ? " · " : ""}${address}</dd>`);
  const price = info.price == null ? "" : `${Number(info.price).toLocaleString(ctx.lang, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${String(info.currency ?? "")}`.trim();
  if (price) facts.push(html`<dt>${labels.price}</dt><dd>${price} ${await node.showText("price_more")}</dd>`);
  if (performers.length) facts.push(html`<dt>${labels.performers}</dt><dd>${performers.join(", ")}</dd>`);

  const external = String(info.external_link ?? "").trim();
  const target = external || await node.url();
  const image = await node.hasFile("stundenplan");
  return html`<div>
  ${parent ? await html.async`<p class=-category><a href="${await parent.url()}">${parent.showTitle()}</a></p>` : ""}
  ${await cmsText(node, "title", "h1")}
  ${await cmsText(node, "subtitle")}
  ${facts.length ? html`<dl class=-facts>${html.join(facts)}</dl>` : ""}
  ${external ? html`<p><a href="${target}">${target}</a></p>` : ""}
  ${await cmsText(node, "main")}
  ${image ? html`<p><img src="${await image.url({ w: 1400, q: 82 })}" alt=""></p>` : ""}
  ${await cmsText(node, "price_included")}
  ${await cmsText(node, "info")}
  ${await (await node.cont("more")).html()}
</div>`;
}

export const cms = { node: { render } };
