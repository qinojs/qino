# security

Slows down and blocks IP addresses that other modules report as suspicious:

```ts
ctx.app.fire("suspicious", { ctx, weight: 3, reason: "form honeypot filled" });
```

Every report adds its `weight` (default 1) to the IP's strength, which halves every hour.
Answers wait strength² ms (5 → 25 ms, 20 → 400 ms), from 50 on they are refused with `429`
until the strength has faded below 50. Waiting holds a connection, a `429` is almost free, so
the delay stays short.
The check runs at `request-start`, before sessions and static files, so it knows no user:
a superuser behind a blocked IP is blocked too.

Strengths live in memory, so the per-request check needs no query. From strength 5 on they
are also stored through [`score`](../score/) on `log_ip`, so a restart does not forgive anyone
and the score backend shows them; one-off slips cost no write.

With [`seo`](../seo/), `robots.txt` disallows `admin-backup/`, a path nothing links to. Whoever
requests it read robots.txt and ignored it, which reports weight 3.

## Ideas

Collected from the former `cms.backend.system.security`:

- Report probes for foreign stacks: `wp-admin`, `xmlrpc.php`, `.env`, `.git`, `phpmyadmin`, `*.php`.
- Report injection patterns in path and query: `union select`, `../`, `<script`, `;cat`.
- Report failed logins (`ctx.loginError`), weighted by cause.
- Check already at `request-start`, so static files and early errors are covered too.
- Report slow requests, large bodies and 5xx bursts per path.
- An allowlist of paths or IPs that never count.
- A backend view `cms.backend.superuser.security`: current IPs, release one, recent reasons.
