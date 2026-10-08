import { sql } from "@qino/qino";
import { mail } from "@qino/qino/fin.invoice";
import { send } from "@qino/qino/messaging.email";

import type { App } from "@qino/qino";

const today = () => new Date().toLocaleDateString("sv-SE");

/** Days after the due date each reminder goes out (`fin.invoice.reminder.days`): "10, 20, 30". */
async function days(app: App): Promise<number[]> {
  return String(await app.settings["fin.invoice.reminder"].days ?? "")
    .split(",").map((d) => parseInt(d)).filter((d) => d >= 0);
}

/**
 * Send an open invoice's next reminder to its user, by mail with its PDF, and count it. Resolves
 * with the reminder sent, `0` where none can go: paid, no user, no address, or all are sent.
 */
export async function remind(app: App, id: number): Promise<number> {
  const invoice = await app.db.row`SELECT * FROM invoice WHERE id = ${id}`;
  const next = Number(invoice?.reminder ?? 0) + 1;
  if (invoice?.status !== "open" || invoice.direction !== "out" || invoice.type !== "invoice" || !invoice.usr_id) return 0;
  if (next > (await days(app)).length) return 0;
  const reached = await send(app, { usr: Number(invoice.usr_id) }, await mail(app, id, { reminder: next }));
  if (!reached) return 0;
  await app.db.exec`UPDATE invoice SET reminder = ${next}, reminded = ${today()} WHERE id = ${id}`;
  return next;
}

/**
 * Remind every open invoice whose next reminder is due: so many days after its due date, and as
 * many after the last one as the levels lie apart — a long overdue invoice does not get them all
 * at once.
 */
export async function remindDue(app: App): Promise<number> {
  const after = await days(app);
  if (!after.length) return 0;
  const before = (d: number) => addDays(today(), -d);
  const due = sql.join(after.map((d, level) => sql`(reminder = ${level} AND due <= ${before(d)}
    AND (reminded IS NULL OR reminded <= ${before(d - (after[level - 1] ?? 0))}))`), " OR ");
  const ids = await app.db.col`SELECT id FROM invoice
    WHERE status = 'open' AND direction = 'out' AND type = 'invoice' AND usr_id IS NOT NULL AND (${due})
    ORDER BY id`;
  let sent = 0;
  for (const id of ids) {
    const level = await remind(app, Number(id)).catch((e) => (console.error("fin.invoice.reminder", id, e), 0));
    if (level) sent++;
  }
  return sent;
}

const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
