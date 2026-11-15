import { sql } from "@qino/qino";
import { overlaps } from "@qino/qino/calendar";

import { decodeRow, encode, select } from "./range.ts";

import type { Node } from "@qino/qino/cms";
import type { Period, Range } from "@qino/qino/calendar";

export { overview } from "./range.ts";

/** Add an event to a CMS node. All-day dates stay dates; timed boundaries are stored in UTC. */
export function add(node: Node, range: Range) {
  return node.db.table("cms_event").insert({ node_id: node.id, ...encode(range) });
}

/** Update only this node's event. Callers authorize writes before using this server API. */
export async function update(node: Node, id: number, range: Range) {
  const data = encode(range);
  if (!await node.db.one`SELECT id FROM cms_event WHERE id = ${id} AND node_id = ${node.id}`) return false;
  await node.db.table("cms_event").update(id, data);
  return true;
}

export async function remove(node: Node, id: number) {
  await node.db.table("cms_event").deleteWhere({ id, node_id: node.id });
}

/** Event definitions are visible only to readers of their owning node. */
export async function list(node: Node) {
  if (await node.access() < 2 && !await node.isReadable()) return [];
  const rows = await node.db.query`SELECT id, ${sql.id("start")}, ${sql.id("end")}, all_day FROM cms_event WHERE node_id = ${node.id} ORDER BY ${sql.id("start")}, id`;
  return rows.map((row) => ({ id: Number(row.id), ...decodeRow(row) }));
}

export async function query(node: Node, period: Period) {
  if (!await node.isReadable()) return [];
  const rows = await node.db.query`${select(period, node.id)}`;
  return rows.map((row) => ({ ...decodeRow(row), eventId: Number(row.id) }))
    .filter((item) => overlaps(item, period, { timeZone: period.timeZone }));
}
