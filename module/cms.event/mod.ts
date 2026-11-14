import { sql } from "@qino/qino";
import { occurrences, overlaps } from "@qino/qino/calendar";

import { schedule, within } from "./schedule.ts";

import type { Node } from "@qino/qino/cms";
import type { Period, Schedule } from "@qino/qino/calendar";

/** Add an event to a CMS node. All-day dates stay dates; timed boundaries are stored in UTC. */
export function add(node: Node, range: Schedule) {
  return node.db.table("cms_event").insert({ node_id: node.id, ...values(range) });
}

/** Update only this node's event. Callers authorize writes before using this server API. */
export async function update(node: Node, id: number, range: Schedule) {
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
  const rows = await node.db.query`SELECT * FROM cms_event WHERE node_id = ${node.id} ORDER BY ${sql.id("start")}, id`;
  return rows.map((row) => ({ id: Number(row.id), ...schedule(row) }));
}

export async function query(node: Node, period: Period) {
  if (!await node.isReadable()) return [];
  const rows = await node.db.query`SELECT * FROM cms_event WHERE node_id = ${node.id} AND ${within(period)} ORDER BY ${sql.id("start")}, id`;
  return rows.flatMap((row) => occurrences(schedule(row), period).map((item) => ({ ...item, eventId: Number(row.id) })));
}

function values(range: Schedule) {
  overlaps(range, range);
  const value = (date: string) => /[Tt ]/.test(date)
    ? (date.includes("[") ? Temporal.ZonedDateTime.from(date).toInstant() : Temporal.Instant.from(date)).toString({ fractionalSecondDigits: 9 })
    : date;
  const timeZone = range.timeZone || (range.start.includes("[") ? Temporal.ZonedDateTime.from(range.start).timeZoneId : "");
  const normalized = { ...range, start: value(range.start), end: value(range.end), timeZone };
  occurrences(normalized, { start: normalized.start, end: normalized.end, timeZone: timeZone || "UTC" });
  return {
    start: normalized.start, end: normalized.end, rrule: range.rrule?.trim() || null, time_zone: timeZone || null,
    rdate: range.rdate?.length ? JSON.stringify(range.rdate.map(value)) : null,
    exdate: range.exdate?.length ? JSON.stringify(range.exdate.map(value)) : null,
  };
}
