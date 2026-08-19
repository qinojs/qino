# messaging

Three things nobody wants to build per channel: the journal of what was sent and received,
the list of ways one person can be reached, and the proof that a contact is really theirs.

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

## One form for every channel

```ts
send(app, to, msg): Promise<number>   // how many destinations were reached
```

`to` is `{ grp }`, `{ usr }` or `{ all: true }`, plus whatever the channel alone can address
(`{ phone }`, `{ chat }`, `{ sub }`, `{ channel }`).

`msg` is `{ text, title?, … }`, and a bare string is the short form of `{ text }`. Only
`text` is required; `title` is what the channels that need one fall back on — `titleOf(msg)`
hands out the first line of the text when none was given, so `send(app, { usr: 42 }, "…")`
works on all of them. Everything else is the channel's own: `parse_mode` and `reply_markup`
for Telegram, `tag` and `actions` for Web Push, `html` and `cc` for mail.

What a channel cannot express, it degrades instead of refusing: a `title` becomes the first
line of an SMS, bold in Telegram, the subject of a mail, the heading of a notification.

## Channels

A module says it can reach people by exporting `messagingChannel` from its plugin, the same
way [serviceworker](../serviceworker/) and the backend dashboard collect what modules declare:

```ts
export const messagingChannel: Channel = {
  name: "sms",          // what lands in the journal's channel column
  label: "SMS",
  color: "--green",     // badge colour, optional
  reach: (app, usrId) => Promise<number>,   // how many destinations this user has
  send,                 // the module's own send() — the declaration is not a wrapper
};
```

`channels(app)` lists what linked modules declare, `channel(app, name)` picks one and
`userChannels(app, usrId)` narrows it to those that can actually reach a user.

[cms.backend.superuser.messaging](../cms.backend.superuser.messaging/) is the only consumer
today: it renders the journal per user and replies over whichever channel is reachable. It
knows no channel by name, so a fourth one costs no backend code.

Channels today: [messaging.sms](../messaging.sms/), [messaging.telegram](../messaging.telegram/),
[messaging.web_push](../messaging.web_push/) and [mail](../mail/).

## Verifying a contact

A phone number or mail address is a claim until the owner proves it — anyone can type
someone else's. Telegram and Web Push need none of this: a `chat_id` comes only from a real
update, an endpoint only from the browser itself.

```ts
const code = await requestCode(app, "sms", usrId, "+41791234567");  // start or resend
await redeemCode(app, "sms", usrId, "+41791234567", code);          // throws unless it proves it
```

Pending claims live in `usr_contact_verification` and **nowhere else**, so `usr_phone` and
`usr_email` hold verified contacts only. That is the point of the separate table: `SELECT *
FROM usr_phone WHERE usr_id = 22` is always legitimate, instead of `WHERE verified IS NOT
NULL` being a rule one can forget once and send to a number that was never anyone's.

The claim is spent when it is redeemed or has expired; a wrong code does not spend it but costs
the account a growing wait, counted in core next to every other wrong proof of identity. Codes last
ten minutes, resending is limited to once a minute, and only a keyed hash is stored. One open
claim per address and channel: a second user asking for the same address is refused until the
first one lapses. `pendingContacts(app, channel, usrId?)` lists what is open,
`dropClaim(app, channel, address)` takes one as proven without its code — what an admin does.

## Storage

`message` — one row per logical message; `data` is the channel-native payload as JSON, so
nothing is lost and nothing has to be normalized.

`message_delivery` — one row per recipient, with the time it was attempted and the error, if
any. `address` is where it actually went; `usr_id` is set only when that address is a
verified contact of that user, so the journal never claims a message reached someone on the
strength of an unproven address.

`usr_contact_verification` — open claims, keyed by channel and address. No cron job: expired
rows are swept whenever a code is requested.

## Possible extensions

- **`notify(app, usrId, msg)`** across the user's channels, with per-user preferences — the
  registry is what it would need; the preference table is what is missing.
- **Raw destinations.** `send(app, "+41791234567", msg)` — a bare string as the recipient,
  for people who have no account. `message_delivery.address` is there for it; what is
  missing is the channels accepting the short form. Never expose it through an api tree: it
  is a spam relay the moment it is reachable over HTTP.
- **Per-recipient markers.** `Hallo {{firstname}}`, as mail already does, for every channel:
  they all send per recipient anyway. The journal would keep the template, not the copies —
  and the escaping has to come from the channel, since only mail wants HTML.
- **mail through the journal.** `mail` declares itself as a channel but still keeps its own
  `mail_recipient` history, so the backend reads it separately.
