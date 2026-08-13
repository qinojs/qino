# Score

`score` ranks rows of any table by how **often** and how **recently** they are accessed —
a fading memory: every access adds 1, the total decays exponentially with a half-life.

```ts
import { scored, hit, forget, sqlScore } from "@qino/qino/score";

export const dependencies = ["core", "score"];

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

`scored()` is the only asynchronous call — it resolves the table's scope id once and caches it, so
everything else stays synchronous. Call it from `init()`, before the first `hit()` or `sqlScore()`;
an unregistered table throws.

The third argument of `sqlScore()` says where the row's primary key sits in your query and
defaults to `<table>.id` — pass it whenever the table is aliased or its key is named differently.
It has to stay qualified (`f.id`, not `id`): a bare column name would bind to the subquery's own
`id` and match every row.

## How it is stored

The obvious form — keeping the raw strength plus a timestamp and decaying it in the
query — needs `exp()` and epoch arithmetic in SQL (not portable, SQLite has no math
functions) and cannot use an index, because every row has to be computed before sorting.

So the stored number is the logarithm of the strength, shifted by time:

    score = ln(strength) + rate · t          rate = ln2 / halfLife

`rate · now` is the same for every row of a table, so it cancels out in any comparison:
`ORDER BY score DESC` **is** the decayed ranking, exactly, with no math in SQL. An access adds
`ln(exp(score) + exp(rate · now))`, computed in JS (`logAdd`); pruning compares against a plain
number. `strength()` converts back to "accesses" for display.

Consequences worth knowing:

- **Idle time is free.** Nothing decays on its own — a stored score never changes until the row
  is hit again. If the platform is frozen for a year, the ranking is exactly as it was; only the
  absolute strengths would be lower (they all shrink by the same factor).
- **The order is exact**, not an approximation, and a time-window prefilter is never needed.
- **The half-life belongs to the table.** Stored values are relative to the `rate` they were
  written with. Changing a half-life makes old and new values incomparable — rescale
  (`score' = ln(strength) + rate' · time`, both columns are there) or clear the table.
- **Positive only.** In log space a strength can be scaled but not pushed below zero, so there is
  no negative hit — `forget(…, keep)` scales it down instead.
- Never-accessed rows sort last: `sqlScore()` yields 0 for them, and a hit writes at least
  `rate · now` — above 0.86 for any half-life below ~39 years. Only a hard `forget(…, keep)` can
  push a row below that, and ranking it behind the never-opened ones is what a demotion is for.

## Tables

    score_scope(id, tbl)                 one row per scored table
    score(scope_id, id, score, time)     primary key (scope_id, id), index (scope_id, score)

The table name lives in `score_scope` and nowhere else: `scope_id` is a `SMALLINT`, two bytes in
the primary key and in the `score` index instead of up to 64. `id` is an integer — the scored
row's primary key. `time` (last access) takes no part in the ranking; it is what a rescale and the
weighting below would need. Composite primary keys are not scored; score the owning entry instead.

Every read filters `scope_id` first, so `(scope_id, score)` carries them all. Stopgap: `install()`
creates it with hand-written SQL, because the schema layer cannot declare composite indexes yet.

A daily cron job deletes rows that faded below 0.02 accesses. Scopes that are no longer registered,
and their scores, stay until they are removed by hand.

## Possible extensions

All of these are additive: nothing below invalidates stored scores or changes how they are read.

**Aspects.** Score the same rows separately per kind of access (any view vs. opening the detail
page), by registering `"file:detail"` as its own scope, with its own half-life. It costs one more
`score_scope` row and nothing per score. Only the delete hook would need work: it looks up the
plain table name and would then have to forget every scope belonging to it.

**A join variant of `sqlScore()`.** The correlated subquery costs one primary-key lookup per
candidate row, which is right for a selective query and wrong for one that ranks a million rows.
A `LEFT JOIN score` returning the same expression would suit that case — as a second function
next to `sqlScore()`, not as a rewrite of it.

**A second, faster-decaying score.** One number cannot tell "ten hits last week, nothing since"
from "two hits yesterday, rising" — both can land on the same value. A second column with a short
half-life (a day) next to the long one (a month) makes the direction readable: in log space
`fast - slow` is the logarithm of the ratio of both strengths, so it is positive while something
gains and negative while it fades. Same write, same trick, one more column — but it only fills
from the day it is added, so a "trending" list has no history to start from.

**Weighting a hit by its distance to the last one.** Today ten accesses within a minute count as
ten; for a person they count as roughly one. And ten accesses spread over ten days say more than
ten in one afternoon. Both are the same knob: derive the weight in `bump()` from `now - time`
(the last access is already stored), e.g. 0.1 after seconds, 1 after an hour, 1.5 after weeks.
Worth doing once real traffic shows single sessions or reload spam distorting the ranking.
