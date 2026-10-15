# security

Slows down and blocks IP addresses that modules report as suspicious. IPv6 addresses count as
their `/64` network, since one connection can rotate through it:

```ts
ctx.app.fire("suspicious", { ctx, weight: 3, reason: "form honeypot filled" });
```

Each report adds its `weight` (default 1) to the IP's strength, which decays with a half-life.
Responses are delayed by strength² ms; above a limit they get `429` until the strength drops again.
A delay holds a connection, a `429` is cheap, so delays stay short. Half-life and limits are
constants at the top of [`lib/guard.ts`](lib/guard.ts).

The check runs at `request-start`, before sessions and static files, so it knows no user: a
superuser behind a blocked IP is blocked too. Reports made while a superuser is signed in don't
count; the early path checks know no user and apply to everyone.

Strengths are kept in memory, so the check needs no query. Above a small value they are also
stored via [`score`](../score/) in `score_log_ip_suspicious`, so a restart forgives nobody and the score backend
shows them; single slips cost no write.

Built-in reports, each in its own file under `lib/`:

- `robotsHoneypot` — with [`seo`](../seo/), `robots.txt` disallows a random path (new on every
  start) that nothing links to. Whoever requests it ignored robots.txt.
- `pathReports` — suspicious paths (`.env`, `.git`, `phpinfo`, …) are reported with a high weight
  and answered with 404 before sessions, static files or routing, even if the path exists. A 404
  on a path of another system (`*.php`, `wp-admin`, `js/`, …) counts lightly. Right after
  replacing an old site these may be real links; then turn off `security.foreignPaths` for a while.

Other modules report themselves. Core weighs every failed login the same; different weights would
show up as different delays and reveal whether an address exists.

## Spam

`spamScore(app, content, { ctx, sender })` tells how likely something sent is spam, 0 to 1 — a form
entry, a comment, an incoming message. The caller decides what to do with it.

- `ctx` (sent by a request): the address's record counts, and a client younger than 20 s looks like
  a bot. A signed-in user has the account's history.
- With [`ai`](../ai/) linked, a model's `decide` judges the content, once per user, address or
  `sender` (e.g. `"email:a@b.ch"`). `context` tells it what the content was sent through, e.g.
  `'the form "Complaints"'`. The content goes to the model as data, with the note that instructions
  in it are not meant for it.
- The signals are independent and add up: one strong one is enough, weak ones together can be too.
- A score from 0.5 on is reported against the address, so it is known next time.

`mod.ts` exposes `suspects(app)`, `reports(app)` (the most recent, in memory) and
`release(app, key)`; [`cms.backend.superuser.security`](../cms.backend.superuser.security/)
shows them.

## Ideas

Collected from the former `cms.backend.system.security`:

- Report injection patterns in path and query: `union select`, `../`, `<script`, `;cat`.
- Report slow requests, large bodies and 5xx bursts per path.
- An allowlist of paths or IPs that never count.
