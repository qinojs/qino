# messaging

Two things nobody wants to build per channel: the journal of what was sent and received, and
the list of ways one person can be reached.

## Journal

`record(app, message, deliveries)` stores one logical message plus one row per recipient, so
"sent to the group" stays one entry while every member keeps their own result. `error` on a
delivery is the whole verdict — null means reached.

```ts
await record(app, { channel: "sms", direction: "out", grpId: 3, data: { text } }, [
  { usrId: 7 },
  { usrId: 9, error: "rejected" },
]);
```

`messages(app, limit)` and `userMessages(app, usrId, limit)` read it back with the deliveries
nested. `channel` is a plain string and outlives module renames — it is data, not a reference.

## Channels

A module says it can reach people by exporting `messagingChannel` from its plugin, the same
way [serviceworker](../serviceworker/) and the backend dashboard collect what modules declare:

```ts
export const messagingChannel: Channel = {
  name: "sms",          // what lands in the journal's channel column
  label: "SMS",
  color: "--green",     // badge colour, optional
  reach: (app, usrId) => Promise<number>,        // how many destinations this user has
  send: (app, usrId, text) => Promise<number>,   // how many were reached
};
```

`channels(app)` lists what linked modules declare, `channel(app, name)` picks one and
`userChannels(app, usrId)` narrows it to those that can actually reach a user. `send` takes
plain text — whatever the channel needs on top (a notification title, a mail subject) it
fills in itself, which is what keeps the caller channel-neutral.

[cms.backend.superuser.messaging](../cms.backend.superuser.messaging/) is the only consumer
today: it renders the journal per user and replies over whichever channel is reachable. It
knows no channel by name, so a fourth one costs no backend code.

Channels today: [messaging.sms](../messaging.sms/), [messaging.telegram](../messaging.telegram/),
[messaging.web_push](../messaging.web_push/) and [mail](../mail/).

## Storage

`message` — one row per logical message; `data` is the channel-native payload as JSON, so
nothing is lost and nothing has to be normalized.

`message_delivery` — one row per recipient, with the time it was attempted and the error, if
any. `usr_id` is null for recipients that are not accounts.

## Possible extensions

- **`notify(app, usrId, text)`** across the user's channels, with per-user preferences — the
  registry is what it would need; the preference table is what is missing.
- **mail through the journal.** `mail` declares itself as a channel but still keeps its own
  `mail_recipient` history, so the backend reads it separately.
