// Rate sources: free, no key, tried in order until one is plausible. Parsers return "units per one
// <base>" (base = 1); the column is USD-based, like in PHP.
import { unixTime } from "@qino/qino";

import type { App } from "@qino/qino";

type Rates = Map<string, number>;

/** `<Cube currency='USD' rate='1.16'/>` — the ECB's daily reference rates, EUR-based. */
function parseEcb(text: string): Rates {
  const rates = new Map([["EUR", 1]]);
  for (const [, id, rate] of text.matchAll(/currency=['"](\w{3})['"]\s+rate=['"]([\d.]+)['"]/g)) rates.set(id, Number(rate));
  return rates;
}

/** `{ "base": "USD", "rates": { "CHF": 0.8, … } }` — what most rate APIs answer. */
function parseJson(text: string): Rates {
  const data = JSON.parse(text);
  const rates = new Map([[String(data.base ?? "USD"), 1]]);
  for (const [id, rate] of Object.entries(data.rates ?? {})) {
    if (/^[A-Z]{3}$/.test(id) && Number(rate) > 0) rates.set(id, Number(rate));
  }
  return rates;
}

/** `<waehrung>100 JPY</waehrung><kurs>0.52</kurs>` — the Swiss customs' (BAZG) daily rates, CHF for so many
 *  units; what Swiss VAT converts with (MWSTV 45). */
function parseBazg(text: string): Rates {
  const rates = new Map([["CHF", 1]]);
  for (const [, units, id, chf] of text.matchAll(/<waehrung>(\d+) (\w{3})<\/waehrung>\s*<kurs>([\d.]+)<\/kurs>/g)) {
    if (Number(chf) > 0) rates.set(id, Number(units) / Number(chf));
  }
  return rates;
}

/** The day before, `YYYYMMDD`: the BAZG publishes a day's rates the day before they apply. */
const eve = (date: string) => new Date(Date.parse(date) - 86400_000).toISOString().slice(0, 10).replaceAll("-", "");

/** `at`: where a source tells the rates of a past day (`YYYY-MM-DD`); the last ones before it on a
 *  day without (a weekend). */
export const SOURCES = [
  { name: "ecb", url: "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml", parse: parseEcb },
  {
    name: "frankfurter",
    url: "https://api.frankfurter.app/latest?base=USD",
    at: (date: string) => `https://api.frankfurter.app/${date}?base=USD`,
    parse: parseJson,
  },
  {
    name: "bazg",
    url: "https://www.backend-rates.bazg.admin.ch/api/xmldaily?locale=en",
    at: (date: string) => `https://www.backend-rates.bazg.admin.ch/api/xmldaily?d=${eve(date)}&locale=en`,
    parse: parseBazg,
  },
  { name: "er-api", url: "https://open.er-api.com/v6/latest/USD", parse: parseJson },
];

/** A source has to carry USD to convert to, and more than that one rate. */
const usable = (rates: Rates) => rates.size > 2 && !!rates.get("USD");

/** Fetch from the first source that answers, and store what it says. */
export async function updateRates(app: App): Promise<{ source: string; written: number }> {
  const { source, rates } = await first(SOURCES, (s) => s.url);
  const written = await store(app, rates);
  await app.settings["locale.currency"].source(source);
  await app.settings["locale.currency"].updated(unixTime());
  // Whoever prices in these currencies can now take their own factors from them.
  await app.fire("currency:rates", {});
  return { source, written };
}

/** A past day's rates do not change and are the same for every app: asked once per process. */
const days = new Map<string, Promise<Rates>>();

/** The rates of a day (`YYYY-MM-DD`), from the first source that knows past days. */
export function ratesOn(date: string): Promise<Rates> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("locale.currency: dates are YYYY-MM-DD");
  const known = days.get(date);
  if (known) return known;
  const rates = first(SOURCES.filter((s) => s.at), (s) => s.at!(date)).then((answer) => answer.rates);
  // today's may still come, and a failure is asked again
  if (date < new Date().toISOString().slice(0, 10)) {
    days.set(date, rates);
    rates.catch(() => days.delete(date));
  }
  return rates;
}

/** The first source in `sources` that answers with usable rates, asked at `urlOf` it. */
async function first(sources: typeof SOURCES, urlOf: (source: typeof SOURCES[number]) => string) {
  const failed = [];
  for (const source of sources) {
    const rates = await read(urlOf(source), source.parse).catch((e: Error) => e);
    if (rates instanceof Error || !usable(rates)) {
      failed.push(`${source.name}: ${rates instanceof Error ? rates.message : "no USD rate or too few"}`);
      continue;
    }
    return { source: source.name, rates };
  }
  throw new Error(`locale.currency: no source answered — ${failed.join("; ")}`);
}

async function read(url: string, parse: (text: string) => Rates) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}`);
  return parse(await res.text());
}

async function store(app: App, rates: Rates) {
  const usd = rates.get("USD")!;
  const known = new Set(await app.db.col<string>`SELECT id FROM currency`);
  const table = app.db.table("currency");
  let written = 0;
  for (const [id, rate] of rates) {
    if (!known.has(id) || !rate) continue;
    await table.update({ id, rate_to_usd: rate / usd });
    written++;
  }
  return written;
}
