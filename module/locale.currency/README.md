# locale.currency

One row per ISO 4217 currency, holding what no standard provides: the exchange rate.

```ts
currency.format(12.5, "CHF", "de-CH"); // CHF 12.50
currency.name("CHF", "de");            // Schweizer Franken
currency.symbol("EUR", "de");          // €
await currency.rate(db, "CHF", "EUR"); // undefined until the rates are filled in
await currency.rate(db, "CHF", "EUR", { date: "2026-10-20" }); // that day's, asked of a source
```

Names, symbols and decimals come from `Intl`, the list from `Intl.supportedValuesOf("currency")`.
The table only holds `rate_to_usd`: how many units one USD buys. USD because the PHP original used
a `base=USD` API; it cancels out in every conversion anyway.

## Where the rates come from

Three free sources without API key, tried in order until one returns plausible data (USD
included, more than one rate):

| | | |
|---|---|---|
| `ecb` | ECB reference rates, XML | EUR-based, working days, ~30 currencies |
| `frankfurter` | api.frankfurter.app | the same ECB data, other infrastructure |
| `bazg` | Swiss customs (BAZG) | CHF-based, working days, ~70 currencies — the rates Swiss VAT converts with (MWSTV 45) |
| `er-api` | open.er-api.com | ~160 currencies, daily |

The source used is stored in `locale.currency.source` and shown in the panel. Fetching contacts
external servers, so it is off by default — `locale.currency.update` is `never`, `daily` or
`hourly`, set in *Configuration → Locale → Currencies*, where rates can also be fetched by hand or
entered manually.

One hourly job covers all frequencies: it checks the rates' age and does nothing if they are fresh.

## Rates of a day

`currency.rate(db, from, to, { date })` asks the sources that know past days (`frankfurter`,
`bazg`) for that day, the first that answers counts; on a day without rates (a weekend) it is the
last ones before. A past day is asked once per process, nothing is stored: whoever books with a
rate keeps it with the booking. Asking for a date is asking a source, whatever `update` says. The
BAZG publishes a day's rates the day before; asked for a day, it is asked for the eve.

*Not* here: which currencies a site offers, rounding, the main currency. That belongs to whoever
sets prices — `shp3` keeps it in `shp3_currency`, as in PHP.
