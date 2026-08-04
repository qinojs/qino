# locale.currency

One row per ISO 4217 currency — and in it the single thing no standard carries: the exchange rate.

```ts
currency.format(12.5, "CHF", "de-CH"); // CHF 12.50
currency.name("CHF", "de");            // Schweizer Franken
currency.symbol("EUR", "de");          // €
await currency.rate(db, "CHF", "EUR"); // undefined until the rates are filled in
```

Names, symbols and the number of decimals come from `Intl`, the list from
`Intl.supportedValuesOf("currency")` — the table holds `rate_to_usd` and nothing else. Rates start
empty; whoever keeps them current (a cron job, an import) writes them.

Deliberately *not* here: which currencies a site offers, what the rounding step is, which one is the
main one. That is the business of whoever prices things — `shp3` keeps it in its own
`shp3_currency`, as the PHP original did.
