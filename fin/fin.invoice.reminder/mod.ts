import { sql } from "@qino/qino";
import { addDays, today, toMinor } from "@qino/qino/fin";
import { create, inLanguage, issue, lines, round, send } from "@qino/qino/fin.invoice";

import type { App, Row } from "@qino/qino";
import type { Line } from "@qino/qino/fin.invoice";

/** A list setting, "10, 20, 30", as numbers. */
const list = (value: unknown) => String(value ?? "").split(",").map((v) => v.trim()).filter(Boolean).map(Number);

/** The settings (`fin.invoice.reminder.*`), read leaf by leaf. */
async function settingsOf(app: App) {
  const s = app.settings["fin.invoice.reminder"];
  const [days, fees, interest, term, issue, send] = await Promise.all([
    s.days, s.fees, s.interest, s.term, s.issue, s.send,
  ]);
  return {
    days: list(days ?? "10, 20, 30").filter((d) => d >= 0),
    fees: list(fees).map((fee) => fee || 0),
    interest: Number(interest) || 0,
    term: Number(term ?? 10),
    issue: issue ?? true,
    send: send ?? true,
  };
}

/** Open invoices of ours with how often they were reminded (`level`), when last (`reminded`), and
 *  whether a reminder of them waits as a draft (`pending`). */
const candidates = (app: App, where: ReturnType<typeof sql>) => app.db.query`
  SELECT i.*,
    (SELECT COUNT(*) FROM invoice_listed l JOIN invoice r ON r.id = l.invoice_id
      WHERE l.listed_id = i.id AND r.type = 'reminder' AND r.status NOT IN ('draft', 'canceled')) AS level,
    (SELECT MAX(r.date) FROM invoice_listed l JOIN invoice r ON r.id = l.invoice_id
      WHERE l.listed_id = i.id AND r.type = 'reminder' AND r.status NOT IN ('draft', 'canceled')) AS reminded,
    (SELECT COUNT(*) FROM invoice_listed l JOIN invoice r ON r.id = l.invoice_id
      WHERE l.listed_id = i.id AND r.type = 'reminder' AND r.status = 'draft') AS pending
  FROM invoice i
  WHERE i.status = 'open' AND i.direction = 'out' AND i.type IN ('invoice', 'reminder') AND ${where}
  ORDER BY i.due, i.id`;

/**
 * Remind what is due: every open invoice of ours — a reminder with fees left open too — whose next
 * level has come, so many days after its due date (`days`) and as many after its last reminder as
 * the levels lie apart. One reminder per debtor and currency; an invoice without a user is one of
 * its own. Held ones (`remind`) and those on a reminder still waiting as a draft are left out.
 * Resolves with how many reminders were made.
 */
export async function remindDue(app: App): Promise<number> {
  const settings = await settingsOf(app);
  const { days } = settings;
  if (!days.length) return 0;
  const before = (d: number) => addDays(today(), -d);
  const rows = await candidates(app, sql`i.remind = ${true} AND i.due <= ${before(days[0])}`);
  const due = rows.filter((row) => {
    const level = Number(row.level);
    if (level >= days.length || Number(row.pending)) return false;
    const apart = days[level] - (days[level - 1] ?? 0);
    return String(row.due) <= before(days[level]) && (!row.reminded || String(row.reminded) <= before(apart));
  });
  const groups = Map.groupBy(due, (row) => `${row.usr_id ?? `#${row.id}`}:${row.currency}`);
  let made = 0;
  for (const group of groups.values()) {
    const ids = group.map((row) => Number(row.id));
    await remind(app, ids).then(() => made++).catch((e) => console.error("fin.invoice.reminder", ids, e));
  }
  return made;
}

/**
 * A reminder of these invoices — one debtor's, in one currency —, each on its next level: listed
 * with what is open on them, with the fee of the highest level (`fees`) and default interest
 * (`interest`) since they were due or last reminded. Issued and mailed as set (`issue`, `send`);
 * resolves with its id. Its slip asks for all of it; money paid on it goes to its fee and interest
 * first, then to the oldest invoice.
 */
export async function remind(app: App, ids: number[]): Promise<number> {
  const settings = await settingsOf(app);
  const items = await candidates(app, sql`${sql.in("i.id", ids)}`);
  if (!items.length || items.length !== new Set(ids).size) {
    throw new Error("fin.invoice.reminder: only open invoices of ours");
  }
  const last = items.at(-1)!;
  if (items.some((item) => item.currency !== last.currency || item.usr_id !== last.usr_id)) {
    throw new Error("fin.invoice.reminder: one reminder is for one debtor, in one currency");
  }
  const level = Math.max(...items.map((item) => Number(item.level) + 1));
  const date = today();
  const currency = String(last.currency);
  const charged = await inLanguage(app, last, async () => [
    ...await feeLines(app, items, toMinor(settings.fees[level - 1] ?? 0, currency)),
    ...await interestLines(app, items, settings.interest, date),
  ]);
  const id = await create(app, {
    type: "reminder",
    currency,
    usrId: last.usr_id == null ? null : Number(last.usr_id),
    party: JSON.parse(String(last.party ?? "{}")) ?? undefined,
    lang: String(last.lang ?? "") || undefined,
    date,
    term: settings.term,
    // the fee is what the customer pays: its tax is in it
    taxIncluded: true,
    lines: charged,
    listed: items.map((item) => ({
      id: Number(item.id),
      open: Number(item.total) - Number(item.paid),
      level: Number(item.level) + 1,
    })),
  });
  if (!settings.issue) return id;
  await issue(app, id);
  if (settings.send) await send(app, id).catch((e) => console.error("fin.invoice.reminder: not mailed", id, e));
  return id;
}

/**
 * The fee as lines. It is part of the price of what it reminds of (MWST-Info 04, 3.8.2.3), so it is
 * taxed as those lines are: shared by rate and category in proportion to what is open of them.
 */
async function feeLines(app: App, items: Row[], fee: number): Promise<Line[]> {
  if (fee <= 0) return [];
  const weights = new Map<string, { taxRate: number; taxCategory: string; weight: number }>();
  for (const item of items) {
    const share = Number(item.total) ? (Number(item.total) - Number(item.paid)) / Number(item.total) : 0;
    for (const line of await lines(app, Number(item.id))) {
      const [taxRate, taxCategory] = [Number(line.tax_rate), String(line.tax_category || "S")];
      const key = `${taxCategory}:${taxRate}`;
      const entry = weights.get(key) ?? { taxRate, taxCategory, weight: 0 };
      weights.set(key, { ...entry, weight: entry.weight + Number(line.amount) * share });
    }
  }
  const parts = [...weights.values()].filter((part) => part.weight > 0);
  const sum = parts.reduce((total, part) => total + part.weight, 0);
  const name = await app.t`Reminder fee`;
  if (!sum) return [{ name, price: fee, taxRate: 0, taxCategory: "O" }];
  const shares = parts.map((part) => ({ ...part, price: round(fee * part.weight / sum) }));
  shares[shares.length - 1].price += fee - shares.reduce((total, part) => total + part.price, 0);
  return shares.filter((part) => part.price)
    .map(({ taxRate, taxCategory, price }) => ({ name, price, taxRate, taxCategory }));
}

/** Default interest at `rate` percent a year on what is open, since it was due or last reminded —
 *  damages, not subject to tax (MWSTG 18 II i). */
async function interestLines(app: App, items: Row[], rate: number, date: string): Promise<Line[]> {
  if (rate <= 0) return [];
  const out: Line[] = [];
  for (const item of items) {
    const days = Math.round((Date.parse(date) - Date.parse(String(item.reminded ?? item.due))) / 86400_000);
    const price = round((Number(item.total) - Number(item.paid)) * rate / 100 * days / 365);
    if (price <= 0) continue;
    const name = await app.t`Default interest ${rate} % on ${item.number} for ${days} days`;
    out.push({ name, price, taxRate: 0, taxCategory: "O" });
  }
  return out;
}
