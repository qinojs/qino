# fin.hosting.plesk

The source type `plesk` of [fin.hosting](../fin.hosting/README.md): a Plesk server as a host. Its daily
sync takes the websites over — each (a webspace's, a subdomain, an addon domain) as a domain we host,
its aliases as aliases of it. New ones show up to be assigned to a customer, ones gone are no longer
billed for hosting.

A source of it has the server's URL (`https://s3.example.com:8443`) and signs in as its user with the
password as secret, or, without user, with an API key as secret (`plesk bin secret_key -c`). It reads
`GET /api/v2/domains`.
