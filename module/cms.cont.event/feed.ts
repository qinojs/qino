import { header, Output } from "@qino/qino";
import { ics, instant } from "@qino/qino/calendar";
import { get, icalStatus, list, titled, zoneOf } from "@qino/qino/cms.event";

import type { Ctx, Row } from "@qino/qino";
import type { Entry } from "@qino/qino/calendar";
import type { Node } from "@qino/qino/cms";

/** GET parameter: the node whose dates are downloaded as iCalendar (an event, or a category's upcoming ones). */
const PARAM = "cms_event_ics";

/** The link to that download: this page's own address, which keeps cmspid and lang, plus the parameter. */
export function feedUrl(ctx: Ctx, node: Node) {
  const url = ctx.req.url.toURL();
  url.searchParams.set(PARAM, String(node.id));
  return url.pathname + url.search;
}

/** Venue name and address of an event. */
export async function place(node: Node, event: Row) {
  const locality = [event.address_postal_code, event.address_locality].filter(Boolean).join(" ");
  const name = (await node.showText("location")).plain().replace(/\s*\n\s*/g, ", ");
  return { name, street: String(event.address_street ?? ""), locality, country: String(event.address_country ?? "") };
}

/** The event's dates as calendar entries, with title, place and description. */
async function entries(node: Node, ctx: Ctx): Promise<(Entry & { location: string; description: string; image?: string })[]> {
  const event = await get(node);
  if (!event) return [];
  const venue = await place(node, event), url = new URL(await node.url(), ctx.req.url.href).href;
  const title = (await node.showTitle()).plain(), description = (await node.showText("main")).plain();
  const location = [venue.name, venue.street, venue.locality, venue.country].filter(Boolean).join(", ") || String(event.online_url ?? "");
  const status = icalStatus(event.status), file = await node.cms.image(node);
  const image = file && new URL(await file.url(), ctx.req.url.href).href;
  return (await list(node)).map(({ name, price: _, ...date }) => ({ ...date, id: `cms.event-${date.id}`, title: titled(title, { name }), url, location, description, status, ...(image && { image }) }));
}

/** Who holds the site's events: its organization, else its name, with its public contact address. */
export async function organizer(node: Node) {
  const identity = node.app.settings.identity;
  const name = String(await identity.organization.name || await identity.name || "");
  return { name, email: String(await identity.contact.email ?? "") };
}

/** Answers the iCalendar request for this node, if it is one; upcoming only, unless it is a single event. */
export async function answer(ctx: Ctx, node: Node, events: () => Promise<Node[]>) {
  if (Number(ctx.req.query[PARAM]) !== node.id) return;
  const now = Temporal.Now.instant(), zone = await zoneOf(node.app, await get(node));
  const nodes = await events();
  const items = (await Promise.all(nodes.map((n) => entries(n, ctx)))).flat()
    .filter((entry) => nodes.length === 1 || Temporal.Instant.compare(instant(entry.end, zone), now) >= 0);
  const name = (await node.showTitle()).plain() || "events";
  throw new Output(ics(items, { host: ctx.req.url.host, organizer: await organizer(node) }), {
    headers: [["Content-Type", "text/calendar; charset=utf-8"], header.contentDisposition("attachment", `${name}.ics`)],
  });
}
