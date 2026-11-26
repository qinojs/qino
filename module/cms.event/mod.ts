import { ApiError, sql } from "@qino/qino";
import { overlaps } from "@qino/qino/calendar";

import { amount, decodeRow, encode, EVENT_FIELDS, select } from "./range.ts";

import type { App, Row } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Period } from "@qino/qino/calendar";
import type { EventDate } from "./range.ts";

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
    out[key] = key === "price" ? amount(value) : (CHECKS[key] ?? ((v) => v))(text(value, key));
  }
  await node.db.table("cms_event").ensure({ id: node.id, ...out });
}

/** What the event's status may be: empty while it takes place as planned (schema.org EventStatusType). */
const STATUSES = ["", "cancelled", "postponed", "rescheduled"];

const fail = (message: string): never => { throw new ApiError(400, message); };
const text = (v: unknown, key: string) => typeof v === "string" ? v.trim() : fail(`Invalid event field: ${key}`);
const code = (v: string, pattern: RegExp, what: string) => !v || pattern.test(v) ? v : fail(`Invalid ${what}`);
const link = (v: string) => {
  const url = v ? URL.parse(v) : undefined;
  return !v ? "" : url && ["http:", "https:"].includes(url.protocol) ? url.href : fail("Links must use HTTP or HTTPS");
};

/** Normalizers of the details that follow a standard; they throw on what is none. Empty is unset. */
const CHECKS: Record<string, (value: string) => string> = {
  time_zone: (v) => { try { return v && new Intl.DateTimeFormat("en", { timeZone: v }).resolvedOptions().timeZone; } catch { throw new ApiError(400, "Invalid time zone"); } },
  currency: (v) => code(v.toUpperCase(), /^[A-Z]{3}$/, "currency (ISO 4217)"),
  address_country: (v) => code(v.toUpperCase(), /^[A-Z]{2}$/, "country (ISO 3166-1)"),
  language: (v) => { try { return v && new Intl.Locale(v).toString(); } catch { throw new ApiError(400, "Invalid language (BCP 47)"); } },
  external_link: link,
  online_url: link,
  status: (v) => STATUSES.includes(v) ? v : fail(`Invalid event status, one of: ${STATUSES.filter(Boolean).join(", ")}`),
};


/** The status as iCalendar has it (RFC 5545): a cancelled event is off, a postponed one tentative. */
export const icalStatus = (status: unknown) => status === "cancelled" ? "CANCELLED" as const : status === "postponed" ? "TENTATIVE" as const : undefined;

/** A date's own name follows the event's title: "Course – Module 1". */
export const titled = (title: string, date: { name?: string }) => date.name ? `${title} – ${date.name}` : title;

/** The IANA zone an event's dates are entered and shown in: its own, else the site's. */
export async function zoneOf(app: App, event?: Row): Promise<string> {
  return String(event?.time_zone || await app.settings["cms.event"].time_zone || "UTC");
}

/** Add a date to the node, making it an event if it is none. Whole dates stay dates; timed ones are stored in UTC. */
export function add(node: Node, date: EventDate): Promise<string | undefined> {
  const values = encode(date); // throws right away on a date that is none
  return node.db.table("cms_event").ensure({ id: node.id }).then(() => node.db.table("cms_event_date").insert({ event_id: node.id, ...values }));
}

/** Update only this node's date. Callers authorize writes before using this server API. */
export async function update(node: Node, id: number, date: EventDate) {
  const data = encode(date);
  if (!await node.db.one`SELECT id FROM cms_event_date WHERE id = ${id} AND event_id = ${node.id}`) return false;
  await node.db.table("cms_event_date").update(id, data);
  return true;
}

export async function remove(node: Node, id: number) {
  await node.db.table("cms_event_date").deleteWhere({ id, event_id: node.id });
}

/** The node's dates, in order. Like the writes a trusted read: who shows them has checked the node. */
export async function list(node: Node) {
  const rows = await node.db.query`SELECT id, ${sql.id("start")}, ${sql.id("end")}, all_day, name, price FROM cms_event_date WHERE event_id = ${node.id} ORDER BY ${sql.id("start")}, id`;
  return rows.map((row) => ({ id: Number(row.id), ...decodeRow(row) }));
}

/** The node's dates that overlap the period. */
export async function query(node: Node, period: Period) {
  const rows = await node.db.query`${select(period, node.id)}`;
  return rows.map((row) => ({ ...decodeRow(row), dateId: Number(row.id) }))
    .filter((item) => overlaps(item, period, { timeZone: period.timeZone }));
}
