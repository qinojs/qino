// deno-lint-ignore-file no-explicit-any -- party and organization are plain data of any shape
import { Ctx, fs, html, requestStorage } from "@qino/qino";
import { fromMinor } from "@qino/qino/fin";
import { file } from "@qino/qino/identity";
import { currency as currencies } from "@qino/qino/locale.currency";

import { lineOf, totals } from "./totals.ts";

import type { App, DbFile, Row } from "@qino/qino";

/** The invoice as an HTML document, in its own language — the default a site may replace. Sender
 *  is `identity.organization`, the recipient the invoice's `party`; both have the same shape. */
export async function document(
  app: App,
  invoice: Row,
  lines: Row[],
  slips: () => Promise<string[]> = () => Promise.resolve([]),
): Promise<string> {
  const lang = languageOf(app, invoice);
  // a credit note reads as what it gives back: its negative amounts shown positive
  if (invoice.type === "credit_note") {
    lines = lines.map((l) => ({ ...l, quantity: -Number(l.quantity), amount: -Number(l.amount) }));
  }
  return await inLang(app, lang, async () => {
    const t = app.t;
    const sender = await organization(app);
    const party = JSON.parse(String(invoice.party ?? "{}")) ?? {};
    // a credit note asks for no payment: no due date, no term
    const asks = invoice.type !== "credit_note";
    const locale = localeOf(lang, sender);
    const money = moneyFormat(locale, String(invoice.currency));
    const day = dayFormat(locale);
    const sum = totals(lines.map(lineOf), Boolean(invoice.tax_included));
    // no tax: no tax rows; one rate: it shows below the lines, a column only where rates differ
    const taxed = sum.rates.some((r) => r.rate);
    const perLine = sum.rates.length > 1;
    const span = perLine ? 5 : 4;
    const logo = await logoUrl(app);
    // the country only counts across a border, as on any letter
    const country = (o: Record<string, any>) => String(o.address?.addressCountry ?? "").toUpperCase();
    const abroad = !!country(party) && country(party) !== country(sender);
    const vat = (o: Record<string, any>) => o.vatID ? html.async`\n${t`VAT ID`} ${o.vatID}` : "";
    return String(await html.async`<!doctype html>
<html lang="${lang}">
<meta charset="utf-8">
<title>${invoice.number}</title>
<style>
  @page { size: A4; margin: 2cm 2cm 2.5cm }
  /* a payment slip (QR bill: 210 × 105 mm) sits on a page of its own, at the bottom, without margins */
  @page slip { margin: 0 }
  .slip { page: slip; break-before: page; padding-top: 192mm }
  .slip svg { display: block; width: 210mm; height: 105mm }
  body { font-family: system-ui, sans-serif; font-size: 10pt; line-height: 1.4 }
  header { display: flex; justify-content: space-between; align-items: start; margin-bottom: 3em }
  address { font-style: normal; white-space: pre-line }
  .to { margin-bottom: 3em }
  /* fixed columns: a table continued on the next page keeps its widths */
  table { width: 100%; border-collapse: collapse; table-layout: fixed }
  .pos { width: 2.5em }
  .quantity { width: 5.5em }
  .price { width: 8em }
  .rate { width: 4em }
  .amount { width: 8.5em }
  th, td { text-align: start; padding: .3em .4em; vertical-align: top }
  thead th { border-bottom: 1px solid }
  .n { text-align: end; white-space: nowrap }
  /* the amounts' currency is in the column head and beside Total */
  tbody .currency, tfoot td .currency { display: none }
  tfoot th, tfoot td { border-top: 1px solid }
  /* the head repeats on every page, the totals only once at the end; a line is not split */
  tfoot { display: table-row-group }
  tr { break-inside: avoid }
  .total { font-weight: bold }
  .text { margin-top: 2em; white-space: pre-line }
  .description { font-size: .9em; white-space: pre-line }
  /* on screen: the sheets as they come out of the printer */
  @media screen {
    html { background: #ccc }
    body { margin: 0; padding: 1rem }
    main, .slip {
      box-sizing: border-box; width: 210mm; min-height: 297mm; margin: 0 auto 1rem;
      background: #fff; box-shadow: 0 0 1em #000a;
    }
    main { padding: 2cm 2cm 2.5cm }
  }
</style>
<main>
<header>
  <address>${addressBlock(sender, abroad)}${vat(sender)}</address>
  ${logo ? html`<img src="${logo}" alt="" style="max-height: 4em">` : ""}
</header>
<address class=to>${addressBlock(party, abroad)}${vat(party)}</address>
<h1>${invoice.type === "credit_note" ? t`Credit note` : t`Invoice`}${invoice.number ? ` ${invoice.number}` : ""}${
  invoice.status === "draft" ? html.async` (${t`draft`})` : ""}</h1>
<p>
  ${invoice.corrected ? html.async`${t`Corrects invoice ${invoice.corrected}`}<br>` : ""}
  ${t`Date`}: ${day(invoice.date)}<br>
  ${asks && invoice.due ? html.async`${t`Due`}: ${day(invoice.due)}<br>` : ""}
  ${asks && invoice.term != null ? t`Payable within ${invoice.term} days` : ""}
</p>
<table>
  <thead><tr>
    <th class=pos>${t`Pos.`}
    <th>${t`Description`}
    <th class="n quantity">${t`Quantity`}
    <th class="n price">${t`Unit price`} <span class=currency>${invoice.currency}</span>
    ${perLine ? html.async`<th class="n rate">${t`Tax`}` : ""}
    <th class="n amount">${t`Amount`} <span class=currency>${invoice.currency}</span>
  <tbody>${lines.map((line, i) => html`<tr>
    <td class=pos>${i + 1}
    <td>${line.name}${line.description ? html`<div class=description>${line.description}</div>` : ""}
    <td class="n quantity">${new Intl.NumberFormat(locale).format(Number(line.quantity))} ${line.unit}
    <td class="n price">${money(Number(line.price))}
    ${perLine ? html`<td class="n rate">${Number(line.tax_rate)} %` : ""}
    <td class="n amount">${money(Number(line.amount))}`)}
  <tfoot>
    ${taxed ? html.async`<tr>
      <th colspan=${span}>${invoice.tax_included ? t`Total excluding tax` : t`Net`}
      <td class=n>${money(sum.net)}` : ""}
    ${sum.rates.filter((r) => r.rate).map((r) => html.async`<tr>
      <th colspan=${span}>${t`Tax`} ${r.rate} % ${t`on`} ${money(r.net)}
      <td class=n>${money(r.tax)}`)}
    <tr class=total>
      <th colspan=${span}>${t`Total`} ${invoice.currency}
      <td class=n>${money(sum.total)}
</table>
${invoice.text ? html`<div class=text>${invoice.text}</div>` : ""}
</main>
${slips().then((list) => list.map((slip) => html`<div class=slip>${html.raw(slip)}</div>`))}
`);
  });
}

/** Formats minor units in the currency's own number of decimals. */
function moneyFormat(locale: string, currency: string) {
  const format = new Intl.NumberFormat(locale, { style: "currency", currency });
  const digits = currencies.decimals(currency);
  const fine = new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: digits + 4 });
  // a unit price may be finer than the currency; only then more decimals are shown
  return (minor: number) => {
    const parts = (Number.isInteger(minor) ? format : fine).formatToParts(minor / 10 ** digits);
    // the currency and the space beside it in a span of their own, for a column to hide
    let a = parts.findIndex((p) => p.type === "currency"), b = a + 1;
    const blank = (i: number) => parts[i]?.type === "literal" && !parts[i].value.trim();
    if (blank(b)) b++;
    else if (blank(a - 1)) a--;
    const text = (from: number, to: number) => parts.slice(from, to).map((p) => p.value).join("");
    return html`${text(0, a)}<span class=currency>${text(a, b)}</span>${text(b, parts.length)}`;
  };
}

/** Formats a `YYYY-MM-DD` day as the locale writes it; nothing for none. */
function dayFormat(locale: string) {
  const format = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  return (date: unknown) => date ? format.format(new Date(`${date}T00:00:00Z`)) : "";
}

/** Name and postal address, one line each; the country only `abroad`. */
function addressBlock(o: Record<string, any>, abroad: boolean) {
  const a = o.address ?? {};
  const town = [a.postalCode, a.addressLocality].filter(Boolean).join(" ");
  const lines = [o.legalName || o.name, a.streetAddress, a.extendedAddress, town, a.addressRegion];
  return html.join([...lines, abroad && a.addressCountry].filter(Boolean), "\n");
}

/** `identity.organization` as a plain object. Settings are read leaf by leaf. */
async function organization(app: App): Promise<Record<string, any>> {
  const o = app.settings.identity.organization;
  const a = o.address;
  const keys = ["streetAddress", "extendedAddress", "postalCode", "addressLocality", "addressRegion", "addressCountry"];
  const [name, legalName, vatID, ...address] = await Promise.all([
    o.name, o.legalName, o.vatID, ...keys.map((k) => a[k]),
  ]);
  return { name, legalName, vatID, address: Object.fromEntries(keys.map((k, i) => [k, address[i]])) };
}

async function logoUrl(app: App) {
  const logo = await file(app, "logo").catch(() => undefined);
  const path = await logo?.url({ h: 160 }).catch(() => undefined);
  return path ? new URL(path, await app.url()).href : undefined;
}

/** The mail an invoice goes out with, in its language: the subject, a few lines, the PDF. A
 *  `reminder` (1, 2 …) asks for what is still open: a payment reminder, then the reminders. */
export async function mail(app: App, invoice: Row, pdf: DbFile, reminder = 0) {
  const lang = languageOf(app, invoice);
  return await inLang(app, lang, async () => {
    const t = app.t;
    const sender = await organization(app);
    const locale = localeOf(lang, sender);
    const currency = String(invoice.currency);
    const amount = new Intl.NumberFormat(locale, { style: "currency", currency })
      .format(fromMinor(Number(invoice.total) - Number(invoice.paid), currency));
    const day = dayFormat(locale);
    const [date, due] = [day(invoice.date), day(invoice.due)];
    const credit = invoice.type === "credit_note";
    const text = credit
      ? [await t`Please find our credit note ${invoice.number} attached.`]
      : reminder
      ? [
        await t`Our invoice ${invoice.number} of ${date} was due on ${due}.`,
        await t`Amount due: ${amount}.`,
        await t`If you have paid it in the meantime, please disregard this message.`,
      ]
      : [
        await t`Please find our invoice ${invoice.number} attached.`,
        due ? await t`Amount due: ${amount}, payable by ${due}.` : await t`Amount due: ${amount}.`,
      ];
    // the first reminder is a friendly one; the ones after it are counted
    const title = await (credit
      ? t`Credit note`
      : reminder === 1
      ? t`Payment reminder`
      : reminder
      ? t`Reminder ${reminder - 1}`
      : t`Invoice`);
    const attachment = { name: pdf.name, type: pdf.mime, content: fs.bytes(pdf.path) };
    return {
      title: `${title} ${invoice.number}`,
      text: [...text, "", sender.legalName || sender.name].join("\n"),
      attachments: [attachment],
    };
  });
}

/** A language the site has no texts for is written in its default one, until t`` knows any language. */
const languageOf = (app: App, invoice: Row) =>
  app.languages.all.includes(String(invoice.lang)) ? String(invoice.lang) : app.languages.def;

/** The invoice's language, in the sender's country: `de-CH`. */
const localeOf = (lang: string, sender: Record<string, any>) =>
  `${lang}-${String(sender.address?.addressCountry ?? "").toUpperCase()}`.replace(/-$/, "");

/** Run `fn` with translations in `lang`: a context of its own, without a request. */
async function inLang<T>(app: App, lang: string, fn: () => Promise<T>) {
  const url = new URL(await app.url());
  const ctx = await Ctx.create(app, new Request(url), { appUrl: url.pathname, url });
  ctx.lang = ctx.langUsr = lang;
  ctx.langNs = "fin"; // the texts recipients read come with the module fin (locale/)
  return await requestStorage.run(ctx, fn).finally(() => ctx.req.cleanup());
}
