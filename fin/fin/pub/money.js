// What the fin pages of users share in the browser: amounts and days as the page's language writes them.

const lang = () => document.documentElement.lang || undefined;

/** Minor units in the currency's own decimals: 47226 CHF is `CHF 472.26`; without a currency, as stored. */
export function money(minor, currency) {
  if (!currency) return String(minor ?? "");
  const format = new Intl.NumberFormat(lang(), { style: "currency", currency });
  return format.format(Number(minor) / 10 ** format.resolvedOptions().maximumFractionDigits);
}

/** A `YYYY-MM-DD` day; nothing for none. */
export const day = (date) =>
  date ? new Date(`${String(date).slice(0, 10)}T00:00:00Z`).toLocaleDateString(lang(), { timeZone: "UTC" }) : "";
