# fin.hosting.infomaniak

The domains registered at Infomaniak, as a registrar of [fin.hosting](../fin.hosting/README.md): its
daily job takes them over — new ones show up to be assigned to a customer, ones moved away are no
longer billed, each with the day its registration ends.

Needs an API token of the Infomaniak manager (profile › developer › API tokens) that may read the
products, in the setting `token`; `account` limits it to one account. It reads
`GET https://api.infomaniak.com/1/products` and keeps the products of `service_name` `domain`.
