// deno-lint-ignore-file no-explicit-any -- party and organization are plain data of any shape
import { Ctx, html, requestStorage } from "@qino/qino";
import { currency as currencies } from "@qino/qino/locale.currency";
import { file } from "@qino/qino/identity";

import { lineOf, totals } from "./totals.ts";

import type { App, Row } from "@qino/qino";

/** The invoice as an HTML document, in its own language — the default a site may replace. Sender
 *  is `identity.organization`, the recipient the invoice's `party`; both have the same shape. */
export async function document(
  app: App,
  invoice: Row,
  lines: Row[],
  slips: () => Promise<string[]> = () => Promise.resolve([]),
): Promise<string> {
  const lang = String(invoice.lang || app.languages.def);
  return await inLang(app, lang, async () => {
    const t = app.t;
    const sender = await organization(app);
    const party = JSON.parse(String(invoice.party ?? "{}")) ?? {};
    const locale = `${lang}-${String(sender.address?.addressCountry ?? "").toUpperCase()}`.replace(/-$/, "");
    const money = moneyFormat(locale, String(invoice.currency));
    const dates = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
    const day = (date: unknown) => date ? dates.format(new Date(`${date}T00:00:00Z`)) : "";
    const sum = totals(lines.map(lineOf), Boolean(invoice.tax_included));
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
  table { width: 100%; border-collapse: collapse }
  th, td { text-align: start; padding: .3em .4em; vertical-align: top }
  thead th { border-bottom: 1px solid }
  .n { text-align: end; white-space: nowrap }
  tfoot th, tfoot td { border-top: 1px solid }
  .total { font-weight: bold }
  .text { margin-top: 2em; white-space: pre-line }
  .description { font-size: .9em; white-space: pre-line }
  /* on screen: the sheets as they come out of the printer */
  @media screen {
    html { background: #ccc }
    body { margin: 0; padding: 1rem }
    main, .slip { box-sizing: border-box; width: 210mm; min-height: 297mm; margin: 0 auto 1rem; background: #fff }
    main { padding: 2cm 2cm 2.5cm }
  }
</style>
<main>
<header>
  <address>${addressBlock(sender, abroad)}${vat(sender)}</address>
  ${logo ? html`<img src="${logo}" alt="" style="max-height: 4em">` : ""}
</header>
<address class=to>${addressBlock(party, abroad)}${vat(party)}</address>
<h1>${invoice.title || t`Invoice`} ${invoice.number}</h1>
<p>
  ${t`Date`}: ${day(invoice.date)}<br>
  ${invoice.due ? html.async`${t`Due`}: ${day(invoice.due)}` : ""}
</p>
<table>
  <thead><tr>
    <th>${t`Description`}
    <th class=n>${t`Quantity`}
    <th class=n>${t`Unit price`}
    <th class=n>${t`Tax`}
    <th class=n>${t`Amount`}
  <tbody>${lines.map((line) => html`<tr>
    <td>${line.name}${line.description ? html`<div class=description>${line.description}</div>` : ""}
    <td class=n>${new Intl.NumberFormat(locale).format(Number(line.quantity))} ${line.unit}
    <td class=n>${money(Number(line.price))}
    <td class=n>${Number(line.tax_rate)} %
    <td class=n>${money(Number(line.amount))}`)}
  <tfoot>
    <tr>
      <th colspan=4>${invoice.tax_included ? t`Total excluding tax` : t`Net`}
      <td class=n>${money(sum.net)}
    ${sum.rates.filter((r) => r.rate).map((r) => html.async`<tr>
      <th colspan=4>${t`Tax`} ${r.rate} % ${t`on`} ${money(r.net)}
      <td class=n>${money(r.tax)}`)}
    <tr class=total>
      <th colspan=4>${t`Total`} ${invoice.currency}
      <td class=n>${money(sum.total)}
</table>
${invoice.text ? html`<div class=text>${invoice.text}</div>` : ""}
</main>
${(await slips()).map((slip) => html`<div class=slip>${html.raw(slip)}</div>`)}
`);
  });
}

/** Formats minor units in the currency's own number of decimals. */
function moneyFormat(locale: string, currency: string) {
  const format = new Intl.NumberFormat(locale, { style: "currency", currency });
  const digits = currencies.decimals(currency);
  const fine = new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: digits + 4 });
  // a unit price may be finer than the currency; only then more decimals are shown
  return (minor: number) => (Number.isInteger(minor) ? format : fine).format(minor / 10 ** digits);
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

/** Run `fn` with translations in `lang`: a context of its own, without a request. */
async function inLang<T>(app: App, lang: string, fn: () => Promise<T>) {
  const url = new URL(await app.url());
  const ctx = await Ctx.create(app, new Request(url), { appUrl: url.pathname, url });
  ctx.lang = ctx.langUsr = lang;
  return await requestStorage.run(ctx, fn).finally(() => ctx.req.cleanup());
}
