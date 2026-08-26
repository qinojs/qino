# social

Minimal public publishing beside `messaging`: plain-text posts go to connected provider targets,
and provider sync mirrors posts and direct responses back into one journal.

```ts
import { publish, targets } from "@qino/qino/social";

const [target] = await targets(app);
await publish(app, target, "We are live.");
```

`time` is the publication time reported by the provider. `sent` is set only when Qino successfully
published the post, so a post observed remotely keeps it null. `log_id` remains the ordinary request
audit link and is not an origin flag: an incoming webhook has a request log too.

Only plain text, publishing, retry and sync are shared initially. Provider modules own connection
settings, targets, API calls and webhook authentication. Media, scheduling, editing, deleting,
analytics and direct messages deliberately have no contract yet.

## Scope decisions

Required for the minimal version:

- retry provider failures with a small default backoff; a provider may override it
- keep target ids independent from configurable connection URLs
- never perform fallible provider work after a remote publish succeeded
- process only unsent outbox rows
- provide a small backend for configuration and a connection check

Deliberately not part of the minimal version:

- a shared outbox abstraction with `messaging`; both queues have different rows and dispatch semantics
- moving `htmlToText` from `messaging` into `core`; that is a separate cross-module cleanup
- renaming `Provider`/`Target`/`publish` to `Channel`/`Recipient`/`send`; the different words express
  the public-vs-addressed boundary between social and messaging
- provider caches; add caching only when measured API traffic requires it
- an API tree for social; the first consumer is the small backend
