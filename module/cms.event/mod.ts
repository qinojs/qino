import { ApiError, sql } from "@qino/qino";
import { overlaps } from "@qino/qino/calendar";

import { decodeRow, encode, EVENT_FIELDS, select } from "./range.ts";

import type { App, Row } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Period, Range } from "@qino/qino/calendar";

export { ahead, overview } from "./range.ts";

/** The node's event, if it is one: its row in cms_event. */
export function get(node: Node): Promise<Row | undefined> {
  return node.db.row`SELECT * FROM cms_event WHERE id = ${node.id}`;
}

/** Makes the node an event if it is none, and stores the given details, checked: what is stored can be shown. */
export async function set(node: Node, values: Record<string, unknown> = {}): Promise<void> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!(EVENT_FIELDS as readonly string[]).includes(key)) throw new ApiError(400, `Unknown event field: ${key}`);
    if (key === "price") {
      if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) throw new ApiError(400, "Invalid event price");
      out.price = value;
      continue;
    }
    if (typeof value !== "string") throw new ApiError(400, `Invalid event field: ${key}`);
    out[key] = CHECKS[key]?.(value.trim()) ?? value.trim();
  }
  await node.db.table("cms_event").ensure({ id: node.id, ...out });
}

/** Normalizers of the details that follow a standard; they throw on what is none. Empty is unset. */
const CHECKS: Record<string, (value: string) => string> = {
  time_zone: (v) => v && new Intl.DateTimeFormat("en", { timeZone: v }).resolvedOptions().timeZone,
  currency: (v) => code(v.toUpperCase(), /^[A-Z]{3}$/, "currency (ISO 4217)"),
  address_country: (v) => code(v.toUpperCase(), /^[A-Z]{2}$/, "country (ISO 3166-1)"),
  language: (v) => { try { return v && new Intl.Locale(v).toString(); } catch { throw new ApiError(400, "Invalid language (BCP 47)"); } },
  external_link: (v) => {
    const url = v ? URL.parse(v) : undefined;
    if (v && (!url || !["http:", "https:"].includes(url.protocol))) throw new ApiError(400, "External links must use HTTP or HTTPS");
    return url?.href ?? "";
  },
};
const code = (v: string, pattern: RegExp, what: string) => {
  if (v && !pattern.test(v)) throw new ApiError(400, `Invalid ${what}`);
  return v;
};

/** The IANA zone an event's dates are entered and shown in: its own, else the site's. */
export async function zoneOf(app: App, event?: Row): Promise<string> {
  return String(event?.time_zone || await app.settings["cms.event"].time_zone || "UTC");
}

/** Add a date to the node, making it an event if it is none. Whole dates stay dates; timed ones are stored in UTC. */
export function add(node: Node, range: Range): Promise<string | undefined> {
  const values = encode(range); // throws right away on a range that is none
  return node.db.table("cms_event").ensure({ id: node.id }).then(() => node.db.table("cms_event_date").insert({ event_id: node.id, ...values }));
}

/** Update only this node's date. Callers authorize writes before using this server API. */
export async function update(node: Node, id: number, range: Range) {
  const data = encode(range);
  if (!await node.db.one`SELECT id FROM cms_event_date WHERE id = ${id} AND event_id = ${node.id}`) return false;
  await node.db.table("cms_event_date").update(id, data);
  return true;
}

export async function remove(node: Node, id: number) {
  await node.db.table("cms_event_date").deleteWhere({ id, event_id: node.id });
}

/** The node's dates, in order. Like the writes a trusted read: who shows them has checked the node. */
export async function list(node: Node) {
  const rows = await node.db.query`SELECT id, ${sql.id("start")}, ${sql.id("end")}, all_day FROM cms_event_date WHERE event_id = ${node.id} ORDER BY ${sql.id("start")}, id`;
  return rows.map((row) => ({ id: Number(row.id), ...decodeRow(row) }));
}

/** The node's dates that overlap the period. */
export async function query(node: Node, period: Period) {
  const rows = await node.db.query`${select(period, node.id)}`;
  return rows.map((row) => ({ ...decodeRow(row), dateId: Number(row.id) }))
    .filter((item) => overlaps(item, period, { timeZone: period.timeZone }));
}
