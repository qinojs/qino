# Score

`score` ranks rows of any table by how **often** and how **recently** they were accessed: every
access adds 1, and the total decays with a half-life.

```ts
// manifest.json: "dependencies": ["core", "score"]
import { scored, hit, forget, sqlScore } from "@qino/qino/score";

export async function init(app) {
  await scored(app.db, "file", 30 * 86400);   // half-life 30 days
}
```

```ts
hit(app.db, "file", id);            // on access — do not await, it must not slow the request
hit(app.db, "file", id, 5);         // counts as five accesses
forget(app.db, "file", id, 0.5);    // keep half of its strength
forget(app.db, "file", id);         // drop it (also happens automatically on row delete)

await app.db.query`
  SELECT * FROM file f
  WHERE f.usr_id = ${33}
  ORDER BY ${sqlScore(app.db, "file", "f.id")} DESC
  LIMIT 20`;

await app.db.query`SELECT * FROM file ORDER BY ${sqlScore(app.db, "file")} DESC LIMIT 20`;
```

`scored()` is the only async call — it loads and caches the table's scope id, so everything else
is synchronous. Call it in `init()`, before the first `hit()` or `sqlScore()`; unregistered tables
throw.

The third argument of `sqlScore()` is the row's primary key in your query, default `<table>.id` —
pass it when the table has an alias or another key name. Keep it qualified (`f.id`, not `id`):
a bare `id` would refer to the subquery's own column and match every row.

## How it is stored

Storing strength + timestamp and decaying in the query would need `exp()` in SQL (SQLite has no
math functions) and could not use an index.

So the stored number is the logarithm of the strength, shifted by time:

    score = ln(strength) + rate · t          rate = ln2 / halfLife

`rate · now` is the same for all rows, so it cancels out when comparing: `ORDER BY score DESC`
**is** the exact decayed ranking, without math in SQL. A hit sets
`ln(exp(score) + exp(rate · now))`, computed in JS (`logAdd`). `strength()` converts back to
"accesses" for display.

Consequences:

- **No background updates.** A score only changes on a hit. After a year without traffic the
  ranking is the same; only absolute strengths are lower (all by the same factor).
- **The order is exact**, no time-window prefilter needed.
- **The half-life belongs to the table.** Values depend on the `rate` used when writing. After
  changing the half-life, rescale (`score' = ln(strength) + rate' · time`) or clear the table.
- **Positive only.** In log space you can scale down but not subtract, so there is no negative hit;
  use `forget(…, keep)`.
- Never-accessed rows sort last: `sqlScore()` gives them 0, and a hit writes at least `rate · now`
  (> 0.86 for any half-life below ~39 years). Only `forget(…, keep)` can push a row below that —
  that's what demoting is for.

## Tables

    score_scope(id, tbl)                 one row per scored table
    score(scope_id, id, score, time)     primary key (scope_id, id), index (scope_id, score)

The table name is only in `score_scope`; `scope_id` is a `SMALLINT` (2 bytes in key and index
instead of up to 64). `id` is the scored row's integer primary key. `time` (last access) is not
used for ranking, only for rescaling and the weighting below. Tables with composite keys can't be
scored; score the parent entry instead.

Every read filters by `scope_id` first, so the `(scope_id, score)` index covers all. `install()`
creates it with raw SQL for now, because the schema layer can't declare composite indexes yet.

A daily cron job deletes rows below 0.02 accesses. Scopes that are no longer registered stay until
removed by hand.

## Possible extensions

All of these only add; stored scores stay valid.

**Aspects.** Score the same rows per kind of access (any view vs. detail page) by registering
`"file:detail"` as its own scope with its own half-life. Costs one `score_scope` row. Only the
delete hook would need to forget all scopes of a table.

**A join variant of `sqlScore()`.** The subquery does one key lookup per candidate row — fine for
selective queries, slow when ranking a million rows. A `LEFT JOIN score` variant would help there,
as a second function.

**A second, faster-decaying score.** One number can't tell "ten hits last week, nothing since" from
"two hits yesterday, rising". A second column with a short half-life (a day) next to the long one
(a month) shows the trend: `fast - slow` is positive while rising, negative while fading. It only
has data from the day it is added.

**Weighting hits by the time since the last one.** Ten hits in a minute count as ten, but are
really one; ten hits over ten days mean more than ten in one afternoon. Derive the weight in
`bump()` from `now - time`, e.g. 0.1 after seconds, 1 after an hour, 1.5 after weeks. Worth it once
reload spam distorts rankings.
