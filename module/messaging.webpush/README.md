# messaging.webpush

Web Push notifications (RFC 8291 / 8292). Stores what a browser hands out when it
subscribes, and delivers notifications to it.

## Sending

```ts
import { send } from "@qino/qino/messaging.webpush";

await send(app, { channel: "news" }, { title: "New article", text: "…", url: "/blog" });
await send(app, { usr: 42 }, "Your order shipped.");
```

Recipients: `{ channel }`, `{ grp }`, `{ usr }`, `{ client }`, `{ sub }`, `{ all: true }`. Add
`notClient` to any of them to skip one device — `reach()` takes it too, so a caller asking "can I
reach this person elsewhere?" gets an honest count. That is how a one-time code stays out of the
browser it would be typed into.
Resolves with the number of browsers reached. Subscriptions the push service reports as
gone (404/410) are deleted on the way, so the table stays clean without a cleanup job.

A notification needs a title, which the other channels do not have — an absent one is the
first line of the text, so the channel-neutral short form works here too. `text` becomes
`body`; everything else reaches `showNotification()` unchanged, so `requireInteraction`,
`tag`, `renotify`, `silent`, `icon`, `badge`, `actions` and friends already work.

## Channels vs. groups

A channel belongs to a **browser**, a group to a **user**. Someone with a laptop and a
phone routinely wants different channels on each, which a group cannot express, and
visitors who never log in have no user to group at all. They answer different questions
and are meant to be used side by side.

Channels are defined in the backend (`cms.backend.superuser.messaging.webpush`); a browser
subscribing to a name that is not defined is silently ignored.

The name avoids "topic" on purpose — RFC 8030 already uses `Topic` for coalescing at the
push service, which is a different thing entirely.

## Subscribing

```js
import { subscribe, unsubscribe, channels } from "/m/messaging.webpush/pub/webpush.js";
await subscribe(["news"]);   // asks for permission; the list replaces what was there
```

The service worker comes from the `serviceworker` module — this module only ships a
`pub/sw.js` that adds its `push` and `notificationclick` listeners.

## VAPID

Keys are generated on first use and stored in settings. Set
`messaging.webpush.subject` to a `mailto:` or `https:` URL the push service operators
can reach you at; the default is `mailto:admin@localhost`.

## Storage

`webpush_subscription` — one row per browser. `endpoint_hash` (SHA-256 of the endpoint)
is the identity, because endpoints are up to 1000 characters and cannot be indexed.
`usr_id` is null for visitors who subscribed without logging in.
`webpush_channel` is the channel catalogue, `webpush_subscription_channel` the
membership.

`error` holds why the last delivery failed, and goes back to null as soon as one
succeeds. It is a state, not a log: nothing acts on it, an admin decides whether to
delete the row. A 404/410 needs no such handling — the browser is gone for good and the
row is removed on the spot.

## Possible extensions

Deliberately not built yet — none of it is needed for the current feature set:

- **Push protocol options.** `sendNotification()` accepts `TTL` (how long the push
  service holds a message for an offline device, default four weeks), `urgency`
  (`very-low`…`high`, whether to deliver while power saving) and `topic` (a new message
  replaces an undelivered one with the same topic). Would be an `opts` argument on
  `send()` — about three lines.
- **Notification actions.** `showNotification` takes up to two buttons; the click
  arrives in `notificationclick` as `event.action`. Needs a few lines in `pub/sw.js`.
- **`pushsubscriptionchange`.** A browser that rotates its subscription stops receiving
  until it subscribes again; today the stale row is dropped on the next send. Handling
  the event means re-subscribing inside the worker and posting the new endpoint.
- **Group coverage in the backend.** Per group: how many of its members can actually be
  reached, and who is missing — the people to remind. The send form's number counts
  subscriptions, so a member with two browsers must not count twice
  (`COUNT(DISTINCT usr_id)` against the group's member count).
- **Per-browser delivery history.** What the push service answered for each subscription.
  That subsumes the `error` column: the column would stay as the
  "is it broken right now" state, the trail answers "what happened when". Needs a table
  that grows per delivery, so it wants a retention policy from day one — and probably
  belongs to `messaging` rather than to this channel alone.
- **Auto-dismissing notifications.** Not possible: the Notification API has no expiry.
  Desktop Chrome hides them after ~20 s by itself, and `requireInteraction: true`
  prevents exactly that. Closing them programmatically would need a timer inside the
  service worker, which may be killed at any time.
