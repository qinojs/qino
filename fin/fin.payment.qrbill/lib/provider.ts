import { requestStorage } from "@qino/qino";
import { fromMinor } from "@qino/qino/fin";
import { paid } from "@qino/qino/fin.bank";
import { SwissQRBill } from "swissqrbill/svg";

import { isQrIban, qrr, scor } from "./reference.ts";

import type { App, Row } from "@qino/qino";
import type { Provider } from "@qino/qino/fin.payment";

/** The currencies a QR bill knows. */
const CURRENCIES = new Set(["CHF", "EUR"]);
const LANGUAGES = new Set(["DE", "FR", "IT", "EN"]);

const iban = async (app: App) => String(await app.settings["fin.payment.qrbill"].iban ?? "").replace(/\s+/g, "");

/**
 * The Swiss QR bill: the payer pays by e-banking or at the counter, the bank statement settles it.
 * The reference — a QR reference with a QR-IBAN, else a creditor reference — is the payment's
 * `external_id`, which [fin.bank](../../fin.bank/) matches.
 */
export const paymentProvider: Provider = {
  name: "qrbill",
  label: "QR-bill",

  async methods(app, { currency }) {
    if (!CURRENCIES.has(currency) || !await iban(app)) return [];
    return [{ name: "", label: "QR-bill" }];
  },

  async start(app, payment, urls) {
    return { redirect: urls.pay, externalId: await referenceOf(app, Number(payment.id)) };
  },

  // What the bank statements said arrived for it; partial transfers add up, and until all is
  // there the slip asks for the rest.
  async sync(app, payment) {
    const arrived = await paid(app, Number(payment.id));
    if (!arrived) return {};
    return { status: arrived >= Number(payment.amount) ? "paid" : "processing", paid: arrived };
  },

  async slip(app, payment) {
    return new SwissQRBill(await billOf(app, payment), { language: await language(app) }).toString();
  },
};

/** A QR reference with a QR-IBAN, a creditor reference otherwise. */
const referenceOf = async (app: App, id: number) => isQrIban(await iban(app)) ? qrr(id) : scor(id);

/** The bill's data: we are the creditor (`identity.organization`), the payer — where its address
 *  is complete, as the standard asks — the debtor; else that is left blank, to be filled in by hand. */
async function billOf(app: App, payment: Row) {
  const o = app.settings.identity.organization;
  const a = o.address;
  const [legalName, name, street, zip, city, country] = await Promise.all([
    o.legalName, o.name, a.streetAddress, a.postalCode, a.addressLocality, a.addressCountry,
  ]).then((values) => values.map((v) => String(v ?? "")));
  const currency = String(payment.currency);
  return {
    // nothing (left) to ask for: the amount is left blank, for the payer to fill in
    amount: Number(payment.amount) > Number(payment.paid)
      ? fromMinor(Number(payment.amount) - Number(payment.paid), currency)
      : undefined,
    currency: currency as "CHF" | "EUR",
    creditor: {
      account: await iban(app),
      name: legalName || name,
      address: street,
      zip,
      city,
      country: country || "CH",
    },
    // a preview has no reference yet: the one its id would get
    reference: String(payment.external_id ?? await referenceOf(app, Number(payment.id))),
    message: payment.description ? String(payment.description) : undefined,
    debtor: debtorOf(payment, country || "CH"),
  };
}

/** The payer as a QR bill's debtor: a structured address, all of it, or none. */
function debtorOf(payment: Row, country: string) {
  const payer = JSON.parse(String(payment.payer ?? "null"));
  const a = payer?.address ?? {};
  if (!payer?.name || !a.streetAddress || !a.postalCode || !a.addressLocality) return;
  // a domestic address names no country: it is the creditor's
  return { name: String(payer.name), address: a.streetAddress, zip: a.postalCode, city: a.addressLocality,
    country: String(a.addressCountry || country).toUpperCase() };
}

/** The slip in the language of the request, else of the site; English where a QR bill has none. */
async function language(app: App): Promise<"DE" | "FR" | "IT" | "EN"> {
  const lang = String(requestStorage.getStore()?.lang ?? app.languages.def).slice(0, 2).toUpperCase();
  return (LANGUAGES.has(lang) ? lang : "EN") as "DE" | "FR" | "IT" | "EN";
}
