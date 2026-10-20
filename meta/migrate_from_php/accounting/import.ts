// Rebuilds the accounting of a qino app from the JSON of export.ts and the PHP invoice PDFs, through
// the fin modules: invoices are issued, payments recorded, so both book themselves. PHP stays the
// master: every run first removes what is there (fin data, the customers of an earlier run), then
// imports anew. Run it in the app's directory, with the service stopped or restarted after:
//
//   deno run -A qino/meta/migrate_from_php/accounting/import.ts accounting.json [invoice-pdfs/]
import { pathToFileURL } from "node:url";
import { addContact, fs, sql, unixTime } from "@qino/qino";
import { attach, create, issue, refOf, setSent } from "@qino/qino/fin.invoice";
import { record } from "@qino/qino/fin.payment";

import type { App } from "@qino/qino";

// deno-lint-ignore no-explicit-any -- rows as PHP's MySQL had them
type Rows = Record<string, any>[];

/** The customers an import brought: the next one removes them again. */
const GROUP = "import:php";

const minor = (chf: unknown) => Math.round(Number(chf) * 100);
/** `YYYY-MM-DD` of a DATE or DATETIME; MySQL's zero date is none. */
const day = (v: unknown) => /^\d{4}-\d\d-\d\d/.test(String(v ?? "")) && !String(v).startsWith("0000") ? String(v).slice(0, 10) : null;
const country = (v: unknown) => /^[a-z]{2}$/i.test(String(v ?? "")) ? String(v).toUpperCase() : null;
const groupBy = (rows: Rows, key: string) => {
  const map = new Map<number, Rows>();
  for (const row of rows) map.set(Number(row[key]), [...map.get(Number(row[key])) ?? [], row]);
  return map;
};

/** All fin data and the customers of an earlier import. */
async function clear(app: App) {
  const db = app.db;
  for (const file of await db.col`SELECT file_id FROM invoice WHERE file_id IS NOT NULL`) {
    await (await app.dbFiles.file(Number(file))).remove().catch(() => {});
  }
  // through the tables: what hangs on a row by schema (lines, periods, entry lines) goes with it
  const tables = ["invoice", "subscription", ...app.modules.linked("fin.accounting") ? ["accounting_entry"] : []];
  for (const table of tables) {
    for (const id of await db.col`SELECT id FROM ${sql.id(table)}`) await db.table(table).delete(id);
  }
  for (const table of ["payment", "payment_credit", "invoice_counter"]) await db.exec`DELETE FROM ${sql.id(table)}`;
  const grp = await db.one`SELECT id FROM grp WHERE name = ${GROUP}`;
  if (grp) for (const usr of await db.col`SELECT usr_id FROM usr_grp WHERE grp_id = ${grp}`) await db.table("usr").delete(usr);
}

async function users(app: App, rows: Rows) {
  const db = app.db;
  const grp = Number(await db.one`SELECT id FROM grp WHERE name = ${GROUP}` ?? await db.table("grp").insert({ name: GROUP }));
  const ids = new Map<number, number>();
  // PHP's superusers too: they may be customers as well; here they are neither superuser nor active
  for (const u of rows) {
    // inactive: no one signs in to a copy
    const id = Number(await db.table("usr").insert({
      active: false, pw: "", superuser: false,
      given_name: u.firstname ?? "", family_name: u.lastname ?? "", organization: u.company || null, lang: u.lang || null,
      street_address: u.street || null, postal_code: u.zip || null, address_locality: u.city || null, address_country: country(u.country),
    }));
    ids.set(Number(u.id), id);
    await db.table("usr_grp").insert({ usr_id: id, grp_id: grp });
    if (u.email) await addContact(db, id, "email", String(u.email)).catch(() => {});
  }
  return ids;
}

async function invoices(app: App, data: Record<string, Rows>, usrs: Map<number, number>, pdfs: string | undefined, report: string[]) {
  const items = groupBy(data.accounting1_invoice_item, "invoice_id");
  const payments = groupBy(data.accounting1_invoice_payment, "invoice_id");
  const ids = new Map<number, number>();
  const reminders = app.modules.linked("fin.invoice.reminder");
  for (const inv of [...data.accounting1_invoice].sort((a, b) => a.id - b.id)) {
    const usrId = usrs.get(Number(inv.recipient_id)) ?? null;
    const currency = String(inv.currency || "CHF");
    const person = [inv.recipient_firstname, inv.recipient_lastname].filter(Boolean).join(" ");
    const party = {
      name: [inv.recipient_company, person].filter(Boolean).join(", "),
      address: {
        streetAddress: inv.recipient_street || undefined, postalCode: inv.recipient_zip || undefined,
        addressLocality: inv.recipient_city || undefined, addressCountry: country(inv.recipient_country) ?? undefined,
      },
    };
    const lines = (items.get(Number(inv.id)) ?? []).sort((a, b) => a.position - b.position || a.id - b.id).map((it) => ({
      name: String(it.title ?? ""),
      description: it.description || undefined,
      quantity: Number(it.amount),
      unit: it.unit || undefined,
      price: Math.round(Number(it.cost) * 100 * 1e4) / 1e4, // minor units, finer where PHP had it
      taxRate: Number(it.vat_rate) || undefined,
    }));
    const text = [inv.text_before, inv.text_after].map((t) => String(t ?? "").trim()).filter(Boolean).join("\n\n");
    const id = await create(app, {
      currency, lines, party, usrId, date: day(inv.date), term: Number(inv.deadline_days) || null,
      lang: inv.lang || "de", text: text || undefined,
    });
    const issued = await issue(app, id);
    ids.set(Number(inv.id), id);
    await app.db.exec`UPDATE invoice SET number = ${String(inv.id)} WHERE id = ${id}`; // PHP's number is its id
    const sent = day(inv.sent_time);
    if (sent) await setSent(app, id, sent);
    if (reminders && Number(inv.dunning)) await app.db.exec`UPDATE invoice SET reminder = ${Number(inv.dunning)} WHERE id = ${id}`;
    const pdf = pdfs && `${pdfs.replace(/\/?$/, "/")}${inv.id}.pdf`;
    if (pdf && await fs.isFile(pdf)) await attach(app, id, await app.dbFiles.add(pdf));
    else if (pdfs) report.push(`invoice ${inv.id}: no PDF`);

    const base = { direction: "in" as const, currency, ref: refOf(id), usrId: usrId ?? undefined };
    for (const p of payments.get(Number(inv.id)) ?? []) {
      if (minor(p.amount) > 0) {
        await record(app, { ...base, provider: "bank", amount: minor(p.amount), description: p.text || `Rechnung ${inv.id}`, date: day(p.time) ?? undefined });
      }
    }
    // marked paid by hand in PHP: what no payment covers was paid there
    const row = await app.db.row`SELECT total, paid FROM invoice WHERE id = ${id}`;
    const rest = Number(row?.total) - Number(row?.paid);
    const paidOn = day(inv.paid_time);
    if (paidOn && rest > 0) await record(app, { ...base, provider: "php", amount: rest, description: `Rechnung ${inv.id}`, date: paidOn });
    const phpTotal = (items.get(Number(inv.id)) ?? []).reduce((sum, it) => sum + Number(it.cost) * Number(it.amount), 0);
    if (minor(phpTotal) !== Number(issued?.total)) report.push(`invoice ${inv.id}: PHP ${phpTotal.toFixed(2)}, qino ${Number(issued?.total) / 100}`);
  }
  return ids;
}

/** Yearly subscriptions; PHP billed them per calendar year, its years become billed periods. */
async function subscriptions(app: App, data: Record<string, Rows>, usrs: Map<number, number>, invs: Map<number, number>, report: string[]) {
  const years = groupBy(data.accounting1_abo1_year, "abo_id");
  for (const abo of data.accounting1_abo1) {
    const usrId = usrs.get(Number(abo.usr_id));
    if (!usrId) {
      report.push(`subscription ${abo.id} (${abo.title}): no customer ${abo.usr_id}`);
      continue;
    }
    const start = day(abo.start_date)!;
    const id = Number(await app.db.table("subscription").insert({
      usr_id: usrId, name: String(abo.title ?? ""), price: minor(abo.cost), currency: "CHF",
      interval_unit: "year", interval_count: 1, start_date: start, end_date: day(abo.end_date), created: unixTime(),
    }));
    for (const y of years.get(Number(abo.id)) ?? []) {
      if (`${y.year}-12-31` < start) {
        report.push(`subscription ${abo.id} (${abo.title}): year ${y.year} before its start ${start}, left out`);
        continue;
      }
      const from = `${y.year}-01-01` > start ? `${y.year}-01-01` : start;
      // a year marked billed without an invoice still counts as billed: the run must not bill it again
      await app.db.table("subscription_invoice").insert({
        subscription_id: id, period_start: from, period_end: `${y.year}-12-31`, invoice_id: invs.get(Number(y.invoice_id)) ?? 0,
      });
    }
  }
}

/** What each customer owes by PHP's account against what is open in qino. */
async function balances(app: App, data: Record<string, Rows>, usrs: Map<number, number>, report: string[]) {
  const php = new Map<number, number>();
  for (const h of data.accounting1_usr_credit_history) php.set(Number(h.usr_id), (php.get(Number(h.usr_id)) ?? 0) + minor(h.value));
  for (const [phpId, balance] of php) {
    const usrId = usrs.get(phpId);
    const open = usrId ? Number(await app.db.one`SELECT COALESCE(SUM(total - paid), 0) FROM invoice WHERE usr_id = ${usrId} AND status = 'open'`) : 0;
    if (balance !== -open) report.push(`customer ${phpId}: PHP account ${balance / 100}, open in qino ${open / 100}`);
  }
}

/** Removes what is there, imports anew; returns what did not add up. */
export async function importAccounting(app: App, data: Record<string, Rows>, pdfs?: string): Promise<string[]> {
  const report: string[] = [];
  const settings = app.settings["fin.invoice"];
  const method = await settings.method;
  await settings.method(""); // the past asks for no payment slips
  try {
    await clear(app);
    const usrs = await users(app, data.usr);
    const invs = await invoices(app, data, usrs, pdfs, report);
    await subscriptions(app, data, usrs, invs, report);
    await balances(app, data, usrs, report);
    await app.db.exec`DELETE FROM invoice_counter`; // new invoices count from their own format
    report.unshift(`${usrs.size} customers, ${invs.size} invoices, ${data.accounting1_abo1.length} subscriptions`);
  } finally {
    await settings.method(method ?? "");
  }
  return report;
}

if (import.meta.main) {
  const [json, pdfs] = Deno.args;
  if (!json) throw new Error("usage: import.ts accounting.json [invoice-pdfs/]");
  const { app } = await import(pathToFileURL(`${Deno.cwd()}/server.ts`).href);
  for (const line of await importAccounting(app, JSON.parse(await Deno.readTextFile(json)), pdfs)) console.log(line);
  Deno.exit(0);
}
