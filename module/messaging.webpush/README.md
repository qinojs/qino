# messaging.webpush

Web Push notifications (RFC 8291 / 8292). Stores browser subscriptions and sends
notifications to them.

## Sending

```ts
import { send } from "@qino/qino/messaging.webpush";

await send(app, { channel: "news" }, { title: "New article", text: "…", url: "/blog" });
await send(app, { usr: 42 }, "Your order shipped.");
```

Recipients: `{ channel }`, `{ grp }`, `{ usr }`, `{ client }`, `{ sub }`, `{ all: true }`;
`client` and `sub` take one id or many. Selectors add up; each browser is reached once.
`notClient` skips one device — `reach()` accepts it too, so "can I reach this person elsewhere?"
gets a correct count. That keeps a one-time code out of the browser it is typed into.

Returns the number of browsers reached. Subscriptions reported as gone (404/410) are deleted right
away.

A notification needs a title; if missing, the first line of the text is used. `text` becomes
`body`; all other fields go to `showNotification()` unchanged, so `requireInteraction`, `tag`,
`renotify`, `silent`, `icon`, `badge`, `actions` etc. work.

## Channels vs. groups

A channel belongs to a **browser**, a group to a **user**. Someone may want different channels on
laptop and phone, and visitors who never log in have no user. Use both side by side.

Channels are defined in the backend (`cms.backend.superuser.messaging.webpush`); unknown channel
names are ignored.

Not called "topic", because RFC 8030 uses `Topic` for something else (replacing queued messages).

## Subscribing

```js
import { subscribe, unsubscribe, channels } from "/m/messaging.webpush/pub/webpush.js";
await subscribe(["news"]);   // asks for permission; the list replaces what was there
```

The service worker comes from the `serviceworker` module; this module only adds `pub/sw.js` with
the `push` and `notificationclick` listeners.

## VAPID

Keys are generated on first use and stored in settings. Set `messaging.webpush.subject` to a
`mailto:` or `https:` contact for the push service operators; default `mailto:admin@localhost`.

## Storage

`webpush_subscription` — one row per browser, identified by `endpoint_hash` (SHA-256), since
endpoints can be 1000 characters long and can't be indexed. `usr_id` is null for anonymous
visitors. `webpush_channel` lists the channels, `webpush_subscription_channel` the memberships.

`error` holds the reason of the last failed delivery, cleared on the next success. Nothing acts on
it; an admin decides whether to delete the row. On 404/410 the row is deleted right away.

## Possible extensions

Not built yet, because not needed so far:

- **Push options.** `sendNotification()` accepts `TTL` (how long an offline device's message is
  kept, default four weeks), `urgency` (`very-low`…`high`) and `topic` (replaces an undelivered
  message with the same topic). An `opts` argument on `send()`, about three lines.
- **Handling action clicks.** Buttons (`actions`) are shown, but the clicked one
  (`event.action` in `notificationclick`) is not handled yet. A few lines in `pub/sw.js`.
- **`pushsubscriptionchange`.** When a browser renews its subscription, it receives nothing until it
  subscribes again; the old row is dropped on the next send. Fix: re-subscribe in the worker and
  post the new endpoint.
- **Group coverage in the backend.** Per group: how many members are reachable and who is missing.
  Count users, not subscriptions (`COUNT(DISTINCT usr_id)`).
- **Delivery history per browser.** What the push service answered each time. `error` would stay as
  the current state. Needs a growing table with a retention policy, and probably belongs to
  `messaging`.
- **Auto-dismiss.** Not possible: notifications have no expiry. Desktop Chrome hides them after
  ~20 s anyway (unless `requireInteraction`). A timer in the service worker is unreliable, since
  it may be stopped any time.
