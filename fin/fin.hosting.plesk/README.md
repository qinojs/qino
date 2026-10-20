# fin.hosting.plesk

The websites hosted on Plesk servers, as hosts of [fin.hosting](../fin.hosting/README.md): its daily
job takes them over — each website (a webspace's, a subdomain, an addon domain) as a domain we host,
its aliases as aliases of it. New ones show up to be assigned to a customer, ones gone are no longer
billed for hosting.

The setting `servers` lists the servers, one URL per line: `https://admin:password@s3.example.com:8443`
signs in as that user, `https://<api key>@s3.example.com:8443` with an API key
(`plesk bin secret_key -c`). Each server is a host of its own, `plesk:s3.example.com`: one that fails
leaves the others' domains as they are. It reads `GET /api/v2/domains`.
