# locale.country

All countries as reference data for other modules — `country(id, iso3, currency, calling,
internet_domain)`, filled with all 250 ISO 3166-1 codes.

Names are not stored: they come from `Intl.DisplayNames` in any language.

```ts
country.name("CH", "de");        // Schweiz
await country.get(db, "CH");     // { id, iso3, currency, calling, internet_domain }
await country.sorted(db, "de");  // ids, ordered the way German sorts the names
```

Usage is up to the consumer: a shop decides where it delivers, a form what it offers — each by
adding its own columns, like `shp3` adds `shp3_enabled` and `shp3_default_vat_rate`. Table and
column names match the PHP original, so migrated databases fit as is.

`install()` only adds what is missing; an edited row keeps its values.
