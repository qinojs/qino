import type { App, Row } from "@qino/qino";

/**
 * Credit notes (EN 16931 type 381): an issued invoice corrected, wholly or in part. A credit note
 * is stored as what it is — negative quantities at the invoice's prices, so its amounts and totals
 * are negative, and any sum over invoices comes out right without asking for the type. It counts
 * on the invoice it corrects as if paid; what it gives beyond what is still open there is owed to
 * the customer — paid back, or put onto their credit — until then it stays open.
 */

/** What issued credit notes take off an invoice: positive, as paid. */
export const credited = (app: App, id: number): Promise<number> =>
  app.db.one`SELECT COALESCE(SUM(total), 0) FROM invoice
    WHERE corrects = ${id} AND type = 'credit_note' AND status IN ('open', 'paid')`.then((sum) => -Number(sum));

/**
 * How much of a credit note is settled, negative like its total: what its invoice did not need of
 * it — the invoice was paid already — is owed, less what was paid back on it (`refunds`).
 */
export async function settledOf(app: App, credit: Row, refunds: number): Promise<number> {
  const given = -Number(credit.total);
  const invoice = credit.corrects ? await app.db.row`SELECT * FROM invoice WHERE id = ${credit.corrects}` : null;
  if (!invoice) return -refunds;
  // the invoice counts its credit notes as paid: beyond its total is what we owe
  const excess = Math.max(0, Number(invoice.paid) - Number(invoice.total));
  return -(given - Math.max(0, Math.min(given, excess) - refunds));
}

/** A draft credit note for an issued invoice: its lines, negative, its party and terms — to be cut
 *  down to what is given back. */
export function creditOf(invoice: Row, lines: Row[]) {
  return {
    type: "credit_note" as const,
    corrects: Number(invoice.id),
    currency: String(invoice.currency),
    lines: lines.map((l) => ({
      name: String(l.name),
      description: l.description ? String(l.description) : undefined,
      quantity: -Number(l.quantity),
      unit: l.unit ? String(l.unit) : undefined,
      price: Number(l.price),
      taxRate: Number(l.tax_rate),
      account: l.account ? String(l.account) : undefined,
    })),
    taxIncluded: Boolean(invoice.tax_included),
    party: JSON.parse(String(invoice.party ?? "{}")) ?? undefined,
    usrId: invoice.usr_id == null ? undefined : Number(invoice.usr_id),
    ref: invoice.ref == null ? undefined : String(invoice.ref),
    lang: String(invoice.lang ?? "") || undefined,
  };
}
