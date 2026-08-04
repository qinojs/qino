// Where the rates come from. Free sources, tried in order until one answers with something
// plausible — no key, no account. Every parser hands back "units per one <base>" including the
// base itself at 1; the column is USD-based, like the PHP original's source was.

import { unixTime, type App } from "../../core/mod.ts";

type Rates = Map<string, number>;

/** `<Cube currency='USD' rate='1.16'/>` — the ECB's daily reference rates, EUR-based. */
function parseEcb(text: string): Rates {
  const rates: Rates = new Map([["EUR", 1]]);
  for (const [, id, rate] of text.matchAll(/currency=['"](\w{3})['"]\s+rate=['"]([\d.]+)['"]/g)) rates.set(id, Number(rate));
  return rates;
}

/** `{ "base": "USD", "rates": { "CHF": 0.8, … } }` — what most rate APIs answer. */
function parseJson(text: string): Rates {
  const data = JSON.parse(text);
  const rates: Rates = new Map([[String(data.base ?? "USD"), 1]]);
  for (const [id, rate] of Object.entries(data.rates ?? {})) {
    if (/^[A-Z]{3}$/.test(id) && Number(rate) > 0) rates.set(id, Number(rate));
  }
  return rates;
}

export const SOURCES = [
  { name: "ecb", url: "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml", parse: parseEcb },
  { name: "frankfurter", url: "https://api.frankfurter.app/latest?base=USD", parse: parseJson },
  { name: "er-api", url: "https://open.er-api.com/v6/latest/USD", parse: parseJson },
];

/** A source has to carry USD to convert to, and more than that one rate. */
const usable = (rates: Rates) => rates.size > 2 && !!rates.get("USD");

/** Fetch from the first source that answers, and store what it says. */
export async function updateRates(app: App, sources = SOURCES): Promise<{ source: string; written: number }> {
  const failed: string[] = [];
  for (const source of sources) {
    const rates = await read(source).catch((e: Error) => e);
    if (rates instanceof Error || !usable(rates)) {
      failed.push(`${source.name}: ${rates instanceof Error ? rates.message : "no USD rate or too few"}`);
      continue;
    }
    const written = await store(app, rates);
    await app.settings["locale.currency"].source(source.name);
    await app.settings["locale.currency"].updated(unixTime());
    // Whoever prices in these currencies can now take their own factors from them.
    await app.fire("currency:rates", {});
    return { source: source.name, written };
  }
  throw new Error(`locale.currency: no source answered — ${failed.join("; ")}`);
}

async function read(source: typeof SOURCES[number]): Promise<Rates> {
  const res = await fetch(source.url);
  if (!res.ok) throw new Error(`${res.status}`);
  return source.parse(await res.text());
}

async function store(app: App, rates: Rates): Promise<number> {
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
