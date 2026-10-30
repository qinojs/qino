// Reading received invoices. Lives in this backend page for now; once something else needs it — the
// mail inbox, an API — it moves into a module of its own (fin.invoice.read).
import { fs, s } from "@qino/qino";
import { structured } from "@qino/qino/ai";
import { mainCurrency } from "@qino/qino/fin";
import { attach, create } from "@qino/qino/fin.invoice";
import { currency as currencies } from "@qino/qino/locale.currency";

import type { App, DbFile, StandardSchema } from "@qino/qino";
import type { Part } from "@qino/qino/ai";

/** What is asked of the model: the invoice as it is printed, amounts as decimals. */
const SCHEMA = s.object({
  supplier: s.object({
    name: s.string(),
    street: s.optional(s.string()),
    postalCode: s.optional(s.string()),
    city: s.optional(s.string()),
    country: s.optional(s.string().describe("ISO 3166 alpha-2")),
    vatID: s.optional(s.string()),
    iban: s.optional(s.string().describe("The account to pay into")),
  }),
  number: s.optional(s.string().describe("The supplier's invoice number")),
  date: s.optional(s.string().describe("YYYY-MM-DD")),
  due: s.optional(s.string().describe("YYYY-MM-DD, empty if none")),
  currency: s.string().describe("ISO 4217"),
  pricesIncludeTax: s.optional(s.boolean().describe("Whether the line prices include VAT")),
  lines: s.array(s.object({
    name: s.string(),
    description: s.optional(s.string().describe("Details below the name, empty if none")),
    quantity: s.number(),
    unit: s.optional(s.string()),
    unitPrice: s.number().describe("Per unit, as printed"),
    taxRate: s.number().describe("VAT percent, 0 if none"),
  })),
  total: s.number().describe("The total to pay, as printed"),
  reference: s.optional(s.string().describe("Payment reference (QR, RF …), empty if none")),
});

const INSTRUCTION = "Read this received invoice. Answer with what is printed, nothing invented: " +
  "dates as YYYY-MM-DD, amounts as numbers without currency or thousands separators. One line per " +
  "invoice position; if there are none, one line for the whole amount. A Swiss QR bill's payment " +
  "part names the account (IBAN), the reference and the amount.";

/** The answer, as the model gives it. */
export type Read = typeof SCHEMA extends StandardSchema<infer T> ? T : never;

/** Pages of a PDF shown as pictures when it has no text: an invoice rarely has more. */
const PAGES = 5;

const picture = async (path: string, type: string): Promise<Part> =>
  ({ type: "image", url: `data:${type};base64,${(await fs.bytes(path)).toBase64()}` });

/**
 * What the model is shown: a PDF's text — its own, or what OCR made of a scan — else its pages
 * as pictures; a photo as it is. The file's transforms do the work.
 */
export async function partsOf(file: DbFile): Promise<Part[]> {
  if (file.mime.startsWith("image/")) return [await picture(file.path, file.mime)];
  if (file.mime !== "application/pdf") throw new Error(`Cannot read ${file.mime || "this file"}: PDF or image only.`);
  const text = (await file.extractText().catch(() => "")).trim();
  if (text.length >= 30) return [{ type: "text", text }];
  const pages: Part[] = [];
  for (let page = 1; page <= PAGES; page++) {
    const shown = await file.transform({ page, w: 1600, fmt: "jpg" });
    if (!shown.transformed) break; // past the last page
    pages.push(await picture(shown.path, shown.mime));
  }
  if (!pages.length) throw new Error("This PDF shows neither text nor pages.");
  return pages;
}

/** The answer as values of a received invoice, in minor units; a currency it lacks is `main`. */
export function valuesOf(read: Read, main = "") {
  const currency = String(read.currency || main).toUpperCase();
  if (!currency) throw new Error("No currency read, and no main currency (fin.mainCurrency)");
  const unit = 10 ** currencies.decimals(currency);
  // a unit price may be finer than a minor unit (0.2345 CHF/kWh): four more decimals are kept
  const minor = (value: number) => Math.round(Number(value) * unit * 1e4) / 1e4;
  const date = (value?: string) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "")) ? value : undefined;
  const s = read.supplier ?? { name: "" };
  const address = Object.fromEntries(Object.entries({
    streetAddress: s.street,
    postalCode: s.postalCode,
    addressLocality: s.city,
    addressCountry: s.country?.toUpperCase(),
  }).filter(([, v]) => v));
  const iban = s.iban ? { iban: s.iban.replace(/\s+/g, "") } : {};
  return {
    direction: "in" as const,
    currency,
    number: read.number || undefined,
    date: date(read.date),
    due: date(read.due),
    taxIncluded: Boolean(read.pricesIncludeTax),
    party: { name: s.name, address, ...s.vatID ? { vatID: s.vatID } : {}, ...iban },
    lines: (read.lines ?? []).map((line) => ({
      name: String(line.name),
      description: line.description || undefined,
      quantity: Number(line.quantity) || 1,
      unit: line.unit || undefined,
      price: minor(line.unitPrice),
      taxRate: Number(line.taxRate) || 0,
    })),
    text: read.reference ? `Reference: ${read.reference}` : undefined,
    // kept to compare: what the model read as total, in minor units
    data: { read: { total: Math.round(Number(read.total) * unit), reference: read.reference || null } },
  };
}

/** The user the supplier is: the one paid into this IBAN, else the organization of this name. */
export async function supplierOf(app: App, party: { name?: string; iban?: string }): Promise<number | null> {
  const byIban = party.iban ? await app.db.one`SELECT id FROM usr WHERE iban = ${party.iban}` : null;
  const byName = byIban ?? (party.name
    ? await app.db.one`SELECT id FROM usr WHERE LOWER(organization) = ${party.name.toLowerCase()} ORDER BY id`
    : null);
  return byName == null ? null : Number(byName);
}

/** Read a received invoice into a draft, its file attached as receipt; its supplier found where known. */
export async function read(app: App, file: DbFile): Promise<number> {
  const parts = await partsOf(file);
  const answer = await structured(app, {
    messages: [{ role: "system", content: INSTRUCTION }, { role: "user", content: parts }],
    schema: SCHEMA,
  });
  const values = valuesOf(answer, await mainCurrency(app));
  const id = await create(app, { ...values, usrId: await supplierOf(app, values.party) });
  await attach(app, id, file);
  return id;
}
