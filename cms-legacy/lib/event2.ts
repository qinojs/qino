import { sql } from "../../module/core/mod.ts";
import type { Node } from "../../module/cms/mod.ts";

export async function eventDates(node: Node): Promise<Record<string, unknown>[]> {
  try {
    return await node.db.query`SELECT * FROM ${sql.id("event2_dates")} WHERE page_id = ${node.id} ORDER BY start_date`;
  } catch { return []; }
}

export async function eventInfo(node: Node): Promise<Record<string, unknown>> {
  try {
    return await node.db.row`SELECT * FROM ${sql.id("event2")} WHERE id = ${node.id}` ?? {};
  } catch { return {}; }
}

export async function eventPerformers(node: Node): Promise<string[]> {
  try {
    const rows = await node.db.query`
      SELECT u.firstname, u.lastname
      FROM ${sql.id("event2_performer")} ep
      JOIN ${sql.id("usr")} u ON u.id = ep.usr_id
      WHERE ep.event_id = ${node.id}
      ORDER BY ep.sort`;
    return rows.map((row) => [row.firstname, row.lastname].filter(Boolean).join(" "));
  } catch { return []; }
}

export function eventDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value).replace(" ", "T"));
}

export function startsTodayOrLater(value: unknown, now = new Date()): boolean {
  const start = eventDate(value);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return !Number.isNaN(+start) && start >= today;
}
