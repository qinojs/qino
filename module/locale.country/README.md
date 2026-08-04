# locale.country

The world's countries, as reference data every module may lean on — `country(id, iso3, currency,
calling, internet_domain)`, seeded with all 250 ISO 3166-1 codes.

What a standard already knows stays out of the table: the name comes from `Intl.DisplayNames`, in
whatever language is asked for, so nothing has to be translated or maintained.

```ts
country.name("CH", "de");        // Schweiz
await country.get(db, "CH");     // { id, iso3, currency, calling, internet_domain }
await country.sorted(db, "de");  // ids, ordered the way German sorts the names
```

The module says nothing about *use*. A shop decides which countries it delivers to, a form which
ones it offers — each by hanging its own column on the table, the way `shp3` adds `shp3_enabled`
and `shp3_default_vat_rate`. Table and column names are the ones the PHP original used, so a
migrated database fits without conversion.

`install()` only adds what is missing; an edited row keeps its values.
