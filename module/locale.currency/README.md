# locale.currency

One row per ISO 4217 currency, holding what no standard provides: the exchange rate.

```ts
currency.format(12.5, "CHF", "de-CH"); // CHF 12.50
currency.name("CHF", "de");            // Schweizer Franken
currency.symbol("EUR", "de");          // €
await currency.rate(db, "CHF", "EUR"); // undefined until the rates are filled in
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
| `er-api` | open.er-api.com | ~160 currencies, daily |

The source used is stored in `locale.currency.source` and shown in the panel. Fetching contacts
external servers, so it is off by default — `locale.currency.update` is `never`, `daily` or
`hourly`, set in *Superuser → Locale → Currencies*, where rates can also be fetched by hand or
entered manually.

One hourly job covers all frequencies: it checks the rates' age and does nothing if they are fresh.

*Not* here: which currencies a site offers, rounding, the main currency. That belongs to whoever
sets prices — `shp3` keeps it in `shp3_currency`, as in PHP.
