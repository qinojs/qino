# locale.geoip

The country of an IP address, looked up in a table held in memory.

```ts
await geoip.country(app, ctx.req.clientIp); // "CH" — undefined if unknown or still loading
await geoip.update(app);                    // fetch the source anew, returns { v4, v6 } ranges
await geoip.size(app);                      // { v4, v6 } ranges in memory, undefined while loading
const country = await geoip.lookup(app);    // sync: country("1.2.3.4") — for a whole list
```

Lookups never wait: the first one starts loading the table in the background and answers
`undefined` until it is there. The table is shared by all apps of a process, one per source.

## Sources

`locale.geoip.source` picks one; there is no fallback to the other.

| | | |
|---|---|---|
| `dbip` (default) | [DB-IP Lite](https://db-ip.com/db/lite.php), monthly | where addresses are used. CC BY 4.0: a page using the result should credit db-ip.com |
| `rir` | the five registries' delegation lists | where blocks were handed out; public, no credit, less exact for multinational blocks |

Files are kept gzipped in `cache/locale.geoip/<source>/` and fetched anew by a weekly job once
older than four weeks.

## Memory

Only range starts are kept, one country byte each: ~360k IPv4 ranges as `Uint32Array` (~1.8 MB),
~370k IPv6 ranges cut to their /64 prefix as `BigUint64Array` (~3.3 MB) — figures for `dbip`.

Country level is right for ~98 % of addresses; VPNs, relays and company proxies are not where
their users are. Good for preselecting a language, currency or country, not for decisions that
must hold.

## Ideas

- **Visitor's country**: profile, else IP, else a default setting — preselects country (and its
  currency) in forms, e.g. shop addresses. The PHP original had it as `locations1::country()`.
- **Login from a new country**: notify the user or fire `suspicious`.
- **Visitors by country**: a widget in the requests backend, counted while rendering.
- **Country restrictions**: e.g. backend login only from CH — a coarse filter, VPNs pass.
