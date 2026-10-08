import { country } from "@qino/qino/locale.country";
import { currency } from "@qino/qino/locale.currency";

import type { App, Row } from "@qino/qino";

/** Today on the server's calendar, `YYYY-MM-DD`. */
export const today = (): string => new Date().toLocaleDateString("sv-SE");

/** `date` (`YYYY-MM-DD`) so many days on, or back with a negative `n`. */
export const addDays = (date: string, n: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

/** `date` so many months on: the 31st becomes the month's last day, the 29th of February the 28th. */
export function addMonths(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const months = y * 12 + m - 1 + n;
  const [year, month] = [Math.floor(months / 12), months % 12];
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** The main currency: `fin.mainCurrency`, else that of the country the organization is in (`identity`). */
export async function mainCurrency(app: App): Promise<string | undefined> {
  const own = String(await app.settings.fin.mainCurrency ?? "").trim().toUpperCase();
  if (own) return own;
  const land = String(await app.settings.identity.organization.address.addressCountry ?? "").toUpperCase();
  return land ? String((await country.get(app.db, land))?.currency ?? "") || undefined : undefined;
}

/** Minor units as the amount people read: 47226 CHF is 472.26, 1000 JPY is 1000. */
export const fromMinor = (minor: number, code: string): number => minor / 10 ** currency.decimals(code);

/** An amount as whole minor units of its currency: 472.26 CHF is 47226. */
export const toMinor = (amount: number, code: string): number => Math.round(amount * 10 ** currency.decimals(code));

/** A user's name as a party: the organization, else the person. */
export const nameOf = (usr: Row): string =>
  String(usr.organization || [usr.given_name, usr.family_name].filter(Boolean).join(" "));

/** A user as an invoice's party: the name and the postal address (schema.org), what is filled in. */
export const partyOf = (usr: Row): { name: string; address: Record<string, string> } => ({
  name: nameOf(usr),
  address: Object.fromEntries(Object.entries({
    streetAddress: usr.street_address,
    postalCode: usr.postal_code,
    addressLocality: usr.address_locality,
    addressRegion: usr.address_region,
    addressCountry: usr.address_country,
  }).filter(([, v]) => v).map(([k, v]) => [k, String(v)])),
});
