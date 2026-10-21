# fin.hosting.infomaniak

The source type `infomaniak` of [fin.hosting](../fin.hosting/README.md): an Infomaniak account as a
registrar. Its daily sync takes the domains over — new ones show up to be assigned to a customer, ones
moved away are no longer billed, each with the day its registration ends.

A source of it needs an API token of the Infomaniak manager (profile › developer › API tokens) that
may read the products, as its secret; the account id as user limits it to that account. It reads
`GET https://api.infomaniak.com/1/products` (or the source's URL) and keeps the products of
`service_name` `domain`.
