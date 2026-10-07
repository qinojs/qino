// Reading received invoices. Lives in this backend page for now; once something else needs it — the
// mail inbox, an API — it moves into a module of its own (fin.invoice.read).
import { structured } from "@qino/qino/ai1";
import { attach, create } from "@qino/qino/fin.invoice";
import { currency as currencies } from "@qino/qino/locale.currency";
import { extractText, getDocumentProxy } from "unpdf";

import type { App, DbFile } from "@qino/qino";
import type { Part } from "@qino/qino/ai1";

/** What is asked of the model: the invoice as it is printed, amounts as decimals. */
const SCHEMA = {
  type: "object",
  properties: {
    supplier: {
      type: "object",
      properties: {
        name: { type: "string" },
        street: { type: "string" },
        postalCode: { type: "string" },
        city: { type: "string" },
        country: { type: "string", description: "ISO 3166 alpha-2" },
        vatID: { type: "string" },
        iban: { type: "string", description: "The account to pay into" },
      },
      required: ["name"],
    },
    number: { type: "string", description: "The supplier's invoice number" },
    date: { type: "string", description: "YYYY-MM-DD" },
    due: { type: "string", description: "YYYY-MM-DD, empty if none" },
    currency: { type: "string", description: "ISO 4217" },
    pricesIncludeTax: { type: "boolean", description: "Whether the line prices include VAT" },
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string", description: "Details below the name, empty if none" },
          qty: { type: "number" },
          unit: { type: "string" },
          unitPrice: { type: "number", description: "Per unit, as printed" },
          taxRate: { type: "number", description: "VAT percent, 0 if none" },
        },
        required: ["name", "qty", "unitPrice", "taxRate"],
      },
    },
    total: { type: "number", description: "The total to pay, as printed" },
    reference: { type: "string", description: "Payment reference (QR, RF …), empty if none" },
  },
  required: ["supplier", "currency", "lines", "total"],
};

const INSTRUCTION = "Read this received invoice. Answer with what is printed, nothing invented: " +
  "dates as YYYY-MM-DD, amounts as numbers without currency or thousands separators. One line per " +
  "invoice position; if there are none, one line for the whole amount. A Swiss QR bill's payment " +
  "part names the account (IBAN), the reference and the amount.";

/** The answer, as the model gives it. */
export type Read = {
  supplier: {
    name: string;
    street?: string;
    postalCode?: string;
    city?: string;
    country?: string;
    vatID?: string;
    iban?: string;
  };
  number?: string;
  date?: string;
  due?: string;
  currency: string;
  pricesIncludeTax?: boolean;
  lines: { name: string; description?: string; qty: number; unit?: string; unitPrice: number; taxRate: number }[];
  total: number;
  reference?: string;
};

/** The text a PDF carries; empty for a scan. pdf.js as unpdf builds it: text only, nothing native. */
export async function pdfText(bytes: Uint8Array): Promise<string> {
  const { text } = await extractText(await getDocumentProxy(bytes.slice()), { mergePages: true });
  return String(text).trim();
}

/** What the model is shown: a PDF's text, or the picture itself. */
async function partsOf(bytes: Uint8Array, type: string): Promise<Part[]> {
  if (type === "application/pdf") {
    const text = await pdfText(bytes);
    // a scan has no text: its pages would have to be pictures (not built yet)
    if (text.length < 30) throw new Error("This PDF is a scan without text: upload its pages as images.");
    return [{ type: "text", text }];
  }
  if (type.startsWith("image/")) return [{ type: "image", url: `data:${type};base64,${bytes.toBase64()}` }];
  throw new Error(`Cannot read ${type || "this file"}: PDF or image only.`);
}

/** The answer as values of a received invoice, in minor units. */
export function valuesOf(read: Read) {
  const currency = String(read.currency || "CHF").toUpperCase();
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
    gross: Boolean(read.pricesIncludeTax),
    party: { name: s.name, address, ...s.vatID ? { vatID: s.vatID } : {}, ...iban },
    lines: (read.lines ?? []).map((line) => ({
      name: String(line.name),
      description: line.description || undefined,
      qty: Number(line.qty) || 1,
      unit: line.unit || undefined,
      price: minor(line.unitPrice),
      taxRate: Number(line.taxRate) || 0,
    })),
    text: read.reference ? `Reference: ${read.reference}` : undefined,
    // kept to compare: what the model read as total, in minor units
    data: { read: { total: Math.round(Number(read.total) * unit), reference: read.reference || null } },
  };
}

/** Read a received invoice into a draft, its file attached as receipt. */
export async function read(app: App, file: DbFile, bytes: Uint8Array, type: string): Promise<number> {
  const parts = await partsOf(bytes, type);
  const answer = await structured<Read>(app, {
    messages: [{ role: "system", content: INSTRUCTION }, { role: "user", content: parts }],
    schema: SCHEMA,
  });
  const id = await create(app, valuesOf(answer));
  await attach(app, id, file);
  return id;
}
