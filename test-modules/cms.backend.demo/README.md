# cms.backend.demo

Fills an installation with demo data — pages, contents, texts, images, users, groups, mail, visits,
short links, error reports — so the backend can be looked at with realistic amounts of content.

```ts
import { reset, wipe } from "./cms.backend.demo/mod.ts";

await reset(app);                                  // replace the demo data
await reset(app, { scale: 5, only: ["pages"] });   // more of it, pages only
await wipe(app);                                   // remove it again
```

The button in the backend (*Demo data*) does the same.

## Only its own data

A run notes every row it inserts — table and entry id — in `data/cms.backend.demo/seed.json`. The
notes are taken from the database itself: while the run is active, inserts made inside its async
context are recorded, so whole subtrees written by `Node.createChild()` are covered without any
seeder cleaning up after itself. Requests running in parallel have another async context and stay
out of it.

`reset()` therefore removes the previous run and nothing else: rows that were already there are
never touched, and neither are shared dictionaries (`log_url`, `log_ip`, `log_user_agent`, settings)
that a run may have added a value to.

## Deterministic

All content comes from a seeded PRNG, so the same `seed` rebuilds the same site — a bug found in
generated content can be reproduced.

## A test fixture

Demo users are real accounts with the password `demo` at the reserved domain `@demo.example`. This
module belongs in the test store, never in a production installation.
