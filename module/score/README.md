# Score

`score` ranks entries by how **often** and how **recently** they were accessed: every access adds 1,
and the total decays with a half-life.

What is scored gets its own table `score_<name>`, declared by the module that scores it, usually
named `<table>_<aspect>`: `page_view`, `file_download`, `ai_agent_memory_use`. Only the key columns
are declared; they become the primary key, `score` and `time` are added. A key column with
`x-qg-parent` deletes the scores along with its row.

```json
"score_page_view_usr": { "additionalProperties": { "properties": {
  "usr_id":  { "type": "integer", "x-qg-parent": "usr" },
  "page_id": { "type": "integer", "x-qg-parent": "page" }
}}}
```

```ts
import { forget, halfLife, hit, sqlScore } from "@qino/qino/score";

halfLife(app.db, "page_view_usr", 7 * 86400);                  // in init(); default 30 days
hit(app.db, "page_view_usr", { usr_id: 3, page_id: 7 });       // on access — do not await
hit(app.db, "page_view_usr", { usr_id: 3, page_id: 7 }, 5);    // counts as five accesses
forget(app.db, "page_view_usr", { usr_id: 3, page_id: 7 }, 0.5); // keep half of its strength
forget(app.db, "page_view_usr", { usr_id: 3 });                // drop all of user 3

await app.db.query`SELECT page_id FROM score_page_view_usr WHERE usr_id = ${3} ORDER BY score DESC LIMIT 10`;
await app.db.query`SELECT * FROM page p
  ORDER BY ${sqlScore(app.db, "page_view_usr", { usr_id: 3, page_id: sql`p.id` })} DESC LIMIT 20`;
```

`sqlScore()` refers to the outer query by qualified columns (`sql\`p.id\``); never-accessed entries
get 0 and sort last.

## How it is stored

Storing strength + timestamp and decaying in the query would need `exp()` in SQL (SQLite has no
math functions) and could not use an index. So the stored number is the logarithm of the strength,
shifted by time:

    score = ln(strength) + rate · t          rate = ln2 / halfLife

`rate · now` is the same for all rows, so `ORDER BY score DESC` **is** the exact decayed ranking.
A hit sets `ln(exp(score) + exp(rate · now))`, computed in JS. `strength()` converts back to
"accesses" for display.

- **No background updates.** A score only changes on a hit; the order stays exact.
- **The half-life belongs to the table.** After changing it, rescale
  (`score' = ln(strength) + rate' · time`) or clear the table.
- **Positive only.** In log space you can scale down but not subtract: use `forget(…, keep)`.

A daily cron job deletes rows below 0.01 accesses.

## Possible extensions

**A join variant of `sqlScore()`.** The subquery does one key lookup per candidate row — fine for
selective queries, slow when ranking a million rows.

**A second, faster-decaying score.** A second table with a short half-life (a day) next to the long
one (a month) shows the trend: `fast - slow` is positive while rising, negative while fading.

**Weighting hits by the time since the last one.** Ten hits in a minute are really one. Derive the
weight in `bump()` from `now - time` once reload spam distorts rankings.
