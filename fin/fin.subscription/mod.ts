import { sql, unixTime } from "@qino/qino";
import { create as invoice, issue, mail } from "@qino/qino/fin.invoice";

import type { App, Row } from "@qino/qino";

const today = () => new Date().toLocaleDateString("sv-SE");

const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

const day = (value: unknown) => String(value).slice(0, 10);

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The day after a period that begins on `date`: so many months or years on, the 31st kept as the
 *  month's last day. */
export function periodAfter(date: string, unit: string, count: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const months = (m - 1) + count * (unit === "month" ? 1 : 12);
  const [year, month] = [y + Math.floor(months / 12), months % 12];
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** The catalog: what is offered, at which price, per which period. */
export const plans = (app: App): Promise<Row[]> => app.db.query`SELECT * FROM subscription_plan ORDER BY name`;

/** Add a plan to the catalog, or change one: a new price applies from each subscription's next period. */
export async function plan(app: App, values: {
  id?: number;
  name: string;
  description?: string | null;
  price: number;
  currency: string;
  taxRate?: number | null;
  unit?: "month" | "year";
  count?: number;
}): Promise<number> {
  if (!Number.isFinite(values.price)) throw new Error("fin.subscription: price in minor units");
  const fields = {
    name: values.name,
    description: values.description || null,
    price: values.price,
    currency: values.currency.toUpperCase(),
    tax_rate: values.taxRate ?? null,
    interval_unit: values.unit ?? "year",
    interval_count: values.count ?? 1,
  };
  if (values.id) {
    await app.db.table("subscription_plan").update(values.id, fields);
    return values.id;
  }
  return Number(await app.db.table("subscription_plan").insert({ ...fields, created: unixTime() }));
}

/**
 * Subscriptions with what applies to them — their own fields, else their plan's — as `label`
 * (what the invoice line says), `detail`, `text` (what it includes), `amount`, `currencyCode`,
 * `rate`, `unit`, `count`, and the first day not billed yet as `next`.
 */
async function withNext(app: App, where: Record<string, unknown> = {}): Promise<Row[]> {
  const filter = Object.keys(where).length ? app.db.table("subscription").valuesToFragment(where, "s") : sql`${true}`;
  const rows = await app.db.query`SELECT s.*,
      (SELECT MAX(i.period_end) FROM subscription_invoice i WHERE i.subscription_id = s.id) AS billed
    FROM subscription s WHERE ${filter} ORDER BY s.usr_id, s.id`;
  const catalog = new Map((await plans(app)).map((p) => [Number(p.id), p]));
  return rows.map((s) => {
    const p = catalog.get(Number(s.plan_id));
    return {
      ...s,
      plan: p,
      label: String(p ? p.name : s.name ?? ""),
      detail: p ? String(s.name ?? "") : "",
      text: String(s.description || p?.description || ""),
      amount: Number(s.price ?? p?.price),
      currencyCode: String(s.currency ?? p?.currency ?? ""),
      rate: s.tax_rate ?? p?.tax_rate ?? null,
      unit: String(s.interval_unit ?? p?.interval_unit ?? "year"),
      count: Number(s.interval_count ?? p?.interval_count ?? 1) || 1,
      next: s.billed ? addDays(day(s.billed), 1) : day(s.start_date),
    };
  });
}

/** A user's subscriptions, or all, each with what applies to it (see `withNext`). */
export const subscriptions = (app: App, usrId?: number): Promise<Row[]> =>
  withNext(app, usrId ? { usr_id: usrId } : {});

/** What a subscription may be given; empty fields take the plan's. */
type Values = {
  planId?: number | null;
  name?: string;
  description?: string | null;
  price?: number | null;
  currency?: string | null;
  taxRate?: number | null;
  unit?: "month" | "year" | null;
  count?: number | null;
  start?: string;
  end?: string | null;
  ref?: string;
};

/** The columns for `values`, as far as given. */
function fieldsOf(values: Values): Record<string, unknown> {
  for (const date of [values.start, values.end]) {
    if (date && !DATE.test(date)) throw new Error("fin.subscription: dates are YYYY-MM-DD");
  }
  if (values.price != null && !Number.isFinite(values.price)) throw new Error("fin.subscription: price in minor units");
  const map: [keyof Values, string, (v: unknown) => unknown][] = [
    ["planId", "plan_id", (v) => v || null],
    ["name", "name", (v) => v],
    ["description", "description", (v) => v || null],
    ["price", "price", (v) => v],
    ["currency", "currency", (v) => v ? String(v).toUpperCase() : null],
    ["taxRate", "tax_rate", (v) => v],
    ["unit", "interval_unit", (v) => v || null],
    ["count", "interval_count", (v) => v || null],
    ["start", "start_date", (v) => v],
    ["end", "end_date", (v) => v || null],
    ["ref", "ref", (v) => v],
  ];
  return Object.fromEntries(map.filter(([key]) => values[key] !== undefined).map(([key, column, to]) =>
    [column, to(values[key])]));
}

/** A new subscription: a plan, or what it is and costs; it begins on `start`. */
export async function subscribe(app: App, values: Values & { usrId: number; start: string }): Promise<number> {
  if (!values.planId && (!values.name || values.price == null || !values.currency)) {
    throw new Error("fin.subscription: a plan, or a name, price and currency");
  }
  return Number(await app.db.table("subscription").insert({
    ...fieldsOf(values),
    usr_id: values.usrId,
    created: unixTime(),
  }));
}

/**
 * Change a subscription. Plan, name, price, tax and period apply from the next period not billed
 * yet; empty takes the plan's again. The end is any day, or `null` to run on. The start only while
 * nothing was billed: the billed periods hang on it.
 */
export async function update(app: App, id: number, values: Values): Promise<void> {
  const [s] = await withNext(app, { id });
  if (!s) throw new Error(`fin.subscription: no subscription ${id}`);
  if (values.start != null && s.billed && values.start !== day(s.start_date)) {
    throw new Error("fin.subscription: billed already — the start stays");
  }
  const fields = fieldsOf(values);
  if (Object.keys(fields).length) await app.db.table("subscription").update(id, fields);
}

/** The periods of a subscription billed so far, the latest first, with their invoices. */
export const periods = (app: App, id: number): Promise<Row[]> =>
  app.db.query`SELECT * FROM subscription_invoice WHERE subscription_id = ${id} ORDER BY period_start DESC`;

/** End it with the period under way: no period begins after it. */
export async function cancel(app: App, id: number): Promise<void> {
  const [s] = await withNext(app, { id });
  if (!s) throw new Error(`fin.subscription: no subscription ${id}`);
  await app.db.exec`UPDATE subscription SET end_date = ${s.next} WHERE id = ${id}`;
}

/**
 * Bill what renews within the lead time (`fin.subscription.lead` days, 30): per user and currency
 * one invoice, a line per period — the plan's name, the detail and the period as its description —
 * in advance, missed periods too. Drafts to look at, issued with `fin.subscription.issue`, and
 * mailed to the customer too with `fin.subscription.send`. Resolves with the invoices.
 */
export async function bill(app: App, { until }: { until?: string } = {}): Promise<number[]> {
  const s = app.settings["fin.subscription"];
  const horizon = until ?? addDays(today(), Number(await s.lead ?? 30));
  const groups = new Map<string, { usrId: number; currency: string; periods: Row[] }>();
  for (const sub of await withNext(app)) {
    for (let start = String(sub.next); start <= horizon && (!sub.end_date || start < day(sub.end_date));) {
      const following = periodAfter(start, String(sub.unit), Number(sub.count));
      const currency = String(sub.currencyCode);
      const key = `${sub.usr_id}:${currency}`;
      const group = groups.get(key) ?? { usrId: Number(sub.usr_id), currency, periods: [] as Row[] };
      group.periods.push({ ...sub, period_start: start, period_end: addDays(following, -1) });
      groups.set(key, group);
      start = following;
    }
  }
  const ids: number[] = [];
  for (const { usrId, currency, periods } of groups.values()) {
    const usr = await app.db.row`SELECT * FROM usr WHERE id = ${usrId}`;
    if (!usr) continue;
    const lang = String(usr.lang || app.languages.def);
    const dates = new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeZone: "UTC" });
    const of = (date: string) => dates.format(new Date(`${date}T00:00:00Z`));
    const id = await app.db.transaction(async () => {
      const id = await invoice(app, {
        currency,
        usrId,
        lang,
        party: partyOf(usr),
        lines: periods.map((p) => ({
          name: String(p.label),
          // the period first, after the detail; below it what it includes
          description: [
            [p.detail, `${of(String(p.period_start))} – ${of(String(p.period_end))}`].filter(Boolean).join(", "),
            p.text,
          ].filter(Boolean).join("\n"),
          price: Number(p.amount),
          taxRate: p.rate == null ? undefined : Number(p.rate),
        })),
      });
      for (const p of periods) {
        await app.db.table("subscription_invoice").insert({
          subscription_id: p.id,
          period_start: p.period_start,
          period_end: p.period_end,
          invoice_id: id,
        });
      }
      return id;
    });
    const send = !!await s.send;
    if (send || await s.issue) await issue(app, id);
    if (send) await mailed(app, id, usrId).catch((e) => console.error("fin.subscription: not mailed", id, e));
    ids.push(id);
  }
  return ids;
}

/** Mail an issued invoice to its user with its PDF, where mail is installed. */
async function mailed(app: App, id: number, usrId: number) {
  if (!app.modules.linked("messaging.email")) return;
  const { send } = await import("@qino/qino/messaging.email");
  await send(app, { usr: usrId }, await mail(app, id));
}

/** A user as an invoice's party: the organization, else the person, at their postal address. */
const partyOf = (u: Row) => ({
  name: String(u.organization || [u.given_name, u.family_name].filter(Boolean).join(" ")),
  address: Object.fromEntries(Object.entries({
    streetAddress: u.street_address,
    postalCode: u.postal_code,
    addressLocality: u.address_locality,
    addressRegion: u.address_region,
    addressCountry: u.address_country,
  }).filter(([, v]) => v).map(([k, v]) => [k, String(v)])),
});
