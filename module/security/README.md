# security

Slows down and blocks IP addresses that other modules report as suspicious. An IPv6 address
counts as its `/64` network, which one connection holds and can rotate the rest of:

```ts
ctx.app.fire("suspicious", { ctx, weight: 3, reason: "form honeypot filled" });
```

Every report adds its `weight` (default 1) to the IP's strength, which fades with a half-life.
Answers wait strength² ms; above a limit they are refused with `429` until the strength has
faded below it. Waiting holds a connection, a `429` is almost free, so the delay stays short.
Half-life and limits are the constants at the top of [`lib/guard.ts`](lib/guard.ts).

The check runs at `request-start`, before sessions and static files, so it knows no user:
a superuser behind a blocked IP is blocked too. Reports caused by a superuser do not count.

Strengths live in memory, so the per-request check needs no query. Above a small strength they
are also stored through [`score`](../score/) on `log_ip`, so a restart does not forgive anyone
and the score backend shows them; one-off slips cost no write.

Built-in reports, each in its own file under `lib/`:

- `robotsHoneypot` — with [`seo`](../seo/), `robots.txt` disallows a random path nothing links
  to, new at every start. Whoever requests it read robots.txt and ignored it.
- `pathReports` — a 404 on a path no site ever links to (`.env`, `.git`, `phpinfo`, …) weighs
  heavily; a 404 on a path of another system (`*.php`, `wp-admin`, `js/`, …) lightly. After
  replacing an old site the latter may be real links, so turn off `security.foreignPaths` for
  a while.

Other modules report on their own; core weighs every failed login the same, because a weight by
cause would be measurable as a delay and so tell an outsider whether an address exists.

`mod.ts` exposes `suspects(app)`, `reports(app)` (the most recent, in memory) and
`release(app, key)`; [`cms.backend.superuser.security`](../cms.backend.superuser.security/)
shows them.

## Ideas

Collected from the former `cms.backend.system.security`:

- Report injection patterns in path and query: `union select`, `../`, `<script`, `;cat`.
- Report slow requests, large bodies and 5xx bursts per path.
- An allowlist of paths or IPs that never count.
