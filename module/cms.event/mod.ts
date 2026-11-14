import { sql } from "@qino/qino";
import { overlaps } from "@qino/qino/calendar";

import { decode, select } from "./range.ts";

import type { Node } from "@qino/qino/cms";
import type { Period, Range } from "@qino/qino/calendar";

/** Add an event to a CMS node. All-day dates stay dates; timed boundaries are stored in UTC. */
export function add(node: Node, range: Range) {
  return node.db.table("cms_event").insert({ node_id: node.id, ...values(range) });
}

/** Update only this node's event. Callers authorize writes before using this server API. */
export async function update(node: Node, id: number, range: Range) {
  const data = values(range);
  if (!await node.db.one`SELECT id FROM cms_event WHERE id = ${id} AND node_id = ${node.id}`) return false;
  await node.db.table("cms_event").update(id, data);
  return true;
}

export async function remove(node: Node, id: number) {
  await node.db.table("cms_event").deleteWhere({ id, node_id: node.id });
}

/** Event definitions are visible only to readers of their owning node. */
export async function list(node: Node) {
  if (!await node.isReadable()) return [];
  const rows = await node.db.query`SELECT id, ${sql.id("start")}, ${sql.id("end")}, all_day FROM cms_event WHERE node_id = ${node.id} ORDER BY ${sql.id("start")}, id`;
  return rows.map((row) => ({ id: Number(row.id), ...decode(row) }));
}

export async function query(node: Node, period: Period) {
  if (!await node.isReadable()) return [];
  const rows = await node.db.query`${select(period, node.id)}`;
  return rows.map((row) => ({ ...decode(row), eventId: Number(row.id) }))
    .filter((item) => overlaps(item, period, { timeZone: period.timeZone }));
}

function values(range: Range) {
  overlaps(range, range);
  const value = (date: string) => {
    if (!/[Tt ]/.test(date)) return Temporal.PlainDate.from(date).toZonedDateTime("UTC").epochMilliseconds;
    const instant = date.includes("[") ? Temporal.ZonedDateTime.from(date).toInstant() : Temporal.Instant.from(date);
    if (instant.epochNanoseconds % 1_000_000n) throw new RangeError("CMS event blocks use millisecond precision");
    return instant.epochMilliseconds;
  };
  return { start: value(range.start), end: value(range.end), all_day: !/[Tt ]/.test(range.start) };
}
