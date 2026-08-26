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
