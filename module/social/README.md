# social

Public posts, next to `messaging`: plain-text posts go to connected provider targets, and sync
mirrors posts and direct replies back into one journal.

```ts
import { publish, targets } from "@qino/qino/social";

const [target] = await targets(app);
await publish(app, target, "We are live.");
```

`time` is the publication time reported by the provider. `sent` is only set when Qino published
the post itself; posts found remotely keep it null. `log_id` is the normal request log link, not an
origin flag — webhooks have a request log too.

Shared for now: plain text, publishing, retry and sync. Provider modules handle connection
settings, targets, API calls and webhook authentication. Media, scheduling, editing, deleting,
analytics and direct messages have no contract yet.

## Scope decisions

Included:

- retry provider failures with a small default backoff (a provider may override it)
- target ids independent of configurable connection URLs
- no provider call that can fail after a remote publish succeeded
- only unsent outbox rows are processed
- a small backend for configuration and a connection check

Deliberately not included:

- a shared outbox with `messaging` — rows and dispatch differ
- moving `htmlToText` from `messaging` into `core` — a separate cleanup
- renaming `Provider`/`Target`/`publish` to `Channel`/`Recipient`/`send` — the different words mark
  public posts vs. addressed messages
- provider caches — only when API traffic requires it
- an API tree — the backend is the only consumer so far
