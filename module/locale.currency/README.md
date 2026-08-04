# locale.currency

One row per ISO 4217 currency — and in it the single thing no standard carries: the exchange rate.

```ts
currency.format(12.5, "CHF", "de-CH"); // CHF 12.50
currency.name("CHF", "de");            // Schweizer Franken
currency.symbol("EUR", "de");          // €
await currency.rate(db, "CHF", "EUR"); // undefined until the rates are filled in
```

Names, symbols and the number of decimals come from `Intl`, the list from
`Intl.supportedValuesOf("currency")` — the table holds `rate_to_usd` and nothing else: how many
units of that currency one USD buys. USD is the anchor because the PHP original read a `base=USD`
API; it cancels out of every conversion anyway.

## Where the rates come from

Three free sources without a key, tried in order until one answers with something plausible (USD
present, more than a single rate):

| | | |
|---|---|---|
| `ecb` | ECB reference rates, XML | EUR-based, working days, ~30 currencies |
| `frankfurter` | api.frankfurter.app | the same ECB data, other infrastructure |
| `er-api` | open.er-api.com | ~160 currencies, daily |

Whichever answered is kept in `locale.currency.source` and shown in the panel. Fetching reaches
outside the server, so it is off until someone says otherwise — `locale.currency.update` is
`never`, `daily` or `hourly`, set in *Superuser → Locale → Currencies*, where the rates can also be
fetched by hand, or typed in while fetching is off.

One hourly job serves all three frequencies: it asks how old the rates may get and goes back to
sleep if they are still fresh enough.

Deliberately *not* here: which currencies a site offers, what the rounding step is, which one is the
main one. That is the business of whoever prices things — `shp3` keeps it in its own
`shp3_currency`, as the PHP original did.
