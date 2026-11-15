import { header, Output } from "@qino/qino";
import { ics, instant } from "@qino/qino/calendar";
import { list } from "@qino/qino/cms.event";

import type { Ctx } from "@qino/qino";
import type { Entry } from "@qino/qino/calendar";
import type { Node } from "@qino/qino/cms";

/** GET parameter: the node whose dates are downloaded as iCalendar (an event, or a category's upcoming ones). */
export const PARAM = "cms_event_ics";

/** Venue name and address of an event, as one line. */
export async function place(node: Node) {
  const s = node.settings;
  const street = String(s.address_street() ?? ""), locality = [s.address_postal_code(), s.address_locality()].filter(Boolean).join(" ");
  return { name: (await node.showText("location")).plain().replace(/\s*\n\s*/g, ", "), street, locality, country: String(s.address_country() ?? "") };
}

/** The event's blocks as calendar entries, with title, place, description and address. */
export async function entries(node: Node, ctx: Ctx): Promise<(Entry & { location: string; description: string })[]> {
  const venue = await place(node), url = new URL(await node.url(), ctx.req.url.href).href;
  const title = (await node.showTitle()).plain(), description = (await node.showText("main")).plain();
  const location = [venue.name, venue.street, venue.locality, venue.country].filter(Boolean).join(", ");
  return (await list(node)).map((block) => ({ ...block, id: `cms.event-${block.id}`, title, url, location, description }));
}

/** Answers the iCalendar request for this node, if it is one; upcoming only, unless it is a single event. */
export async function answer(ctx: Ctx, node: Node, events: () => Promise<Node[]>) {
  if (Number(ctx.req.query[PARAM]) !== node.id) return;
  const now = Temporal.Now.instant(), zone = String(node.settings.time_zone() ?? "UTC");
  const nodes = await events();
  const items = (await Promise.all(nodes.map((n) => entries(n, ctx)))).flat()
    .filter((entry) => nodes.length === 1 || Temporal.Instant.compare(instant(entry.end, zone), now) >= 0);
  const name = (await node.showTitle()).plain() || "events";
  throw new Output(ics(items, { host: ctx.req.url.host }), {
    headers: [["Content-Type", "text/calendar; charset=utf-8"], header.contentDisposition("attachment", `${name}.ics`)],
  });
}
