# messaging

Three things nobody wants to build per channel: the journal of what was sent and received,
the list of ways one person can be reached, and the proof that a contact is really theirs.

## Journal

`record(app, message, deliveries)` stores one logical message plus one row per recipient, so
"sent to the group" stays one entry while every member keeps their own result. `error` on a
delivery is the whole verdict — null means reached.

```ts
await record(app, { channel: "sms", direction: "out", grpId: 3, msg, data: { to } }, [
  { usrId: 7 },
  { usrId: 9, error: "rejected" },
]);
```

`msg` is the channel-neutral part and lands in the `title` and `text` columns, so reading or
searching the journal needs no knowledge of any channel; `data` stays the channel-native payload
and routing. A message with no text of its own — a verification code, a link — simply has none.

`messages(app, limit)` and `userMessages(app, usrId, limit)` read it back with the deliveries
nested. `channel` is a plain string and outlives module renames — it is data, not a reference.

## One form for every channel

```ts
send(app, to, msg): Promise<number>   // how many destinations were reached
```

`to` is `{ grp }`, `{ usr }` or `{ all: true }` everywhere, plus whatever the channel alone can
address:

| Modul | `to` |
| --- | --- |
| messaging.email | `{ grp?, usr?, all?, email? }` |
| messaging.sms | `{ grp?, usr?, all?, phone? }` |
| messaging.telegram | `{ grp?, usr?, all?, chat? }` |
| messaging.webpush | `{ grp?, usr?, all?, channel?, client?, sub?, notClient? }` |

`email` and `phone` are the destination itself — an address, an E.164 number — and reach it whether
or not anyone verified it. If a verified contact matches, the delivery is journaled as that user's,
so a mail to a typed-in address still joins their conversation. `chat` and `sub` are rows in the
channel's own table, because a Telegram chat and a push endpoint exist only once they were linked.

`msg` is `{ text, title?, format?, … }`, and a bare string is the short form of `{ text }`. Only
`text` is required; `title` is what the channels that need one fall back on — `titleOf(msg)`
hands out the first line of the text when none was given, so `send(app, { usr: 42 }, "…")`
works on all of them. Everything else is the channel's own: `parse_mode` and `reply_markup`
for Telegram, `tag` and `actions` for Web Push, `cc` for mail.

What a channel cannot express, it degrades instead of refusing: a `title` becomes the first
line of an SMS, bold in Telegram, the subject of a mail, the heading of a notification.

## Format

`format` says what the text *is*, never how it is delivered — the same distinction `usr_contact.type`
makes about addresses:

```ts
send(app, to, "plain text")                                  // goes out exactly as written
send(app, to, { text: "**shipped**", format: "md" })         // markup where a channel has it
send(app, to, { text: "<p>…</p>", format: "html" })          // a document, mail only
```

Two functions answer for every channel, and no channel converts anything itself:

| | |
| --- | --- |
| `textOf(msg)` | plain text — markdown flattened (a link keeps its address), html stripped |
| `htmlOf(msg, profile?)` | the markup, or `undefined` when the message is plain text |

`profile` narrows the markup to what a channel accepts: `telegram` has no headings, lists or
paragraphs, so those arrive as bold lines, bullets and blank lines. Markdown is a small subset —
headings, lists, quotes, fenced code, `**bold**`, `*italic*`, `` `code` `` and links — and it is
escaped before any marker is read, so a message can never smuggle markup past its format. Only
`http`, `https`, `mailto` and `tel` links survive.

Nothing sanitizes on the way out: a mail client is not a page. `sanitizeHtml(html)` is for the
way *in* — a panel that renders journal HTML must pass it through, because a message is written
by whoever sent it.

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

Channels today: [messaging.email](../messaging.email/), [messaging.sms](../messaging.sms/),
[messaging.telegram](../messaging.telegram/) and [messaging.webpush](../messaging.webpush/).
[mail](../mail/) is not one of them any more — `messaging.email` is its successor and owns the
`email` channel alone.

## Verifying a contact

A phone number or mail address is a claim until the owner proves it — anyone can type
someone else's. Telegram and Web Push need none of this: a `chat_id` comes only from a real
update, an endpoint only from the browser itself.

```ts
const code = await requestCode(app, "sms", usrId, "+41791234567");  // start or resend
await redeemCode(app, "sms", usrId, "+41791234567", code);          // throws unless it proves it
```

Pending claims live in `usr_contact_verification` and **nowhere else**; a proven one moves into
core's `usr_contact`. That is the point of the two tables: `SELECT * FROM usr_contact WHERE
usr_id = 22` is always legitimate, instead of `WHERE verified IS NOT NULL` being a rule one can
forget once and send to a number that was never anyone's.

`usr_contact` belongs to [core](../core/docs/db.md), not here — where a person can be reached is
part of the user, and `usr.contacts.add("email", "a@b.ch")` needs no messaging module. What lives
here is the proof: only a channel can deliver the code that turns a claim into a contact.

Both tables are keyed by the **kind** of address, never by the channel: `phone`, `email`. One
number serves sms, whatsapp and signal, and nobody should prove the same number once per transport.
A channel says which kind it delivers to with `contact`; Telegram and Web Push name none, because
those destinations are linked, never typed.

Core owns what a kind means — `contactKey(type, address)` returns the one form it is stored and
found under, or throws: `0041 79 123 45 67` and `+41 79 123 45 67` are the same contact, and so are
`Kim@Example.com` and `kim@example.com`. Everything a form, an import or a provider hands in goes
through it, so no notation and no stray space can make a second contact or a claim that cannot be
redeemed.

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
