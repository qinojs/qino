# messaging

What every channel needs, built once: a journal of sent and received messages, the list of ways a
person can be reached, and verification that a contact really belongs to them.

## Sending

`send()` lives in the channel module; import the one you want:

```ts
import { send } from "@qino/qino/messaging.email";

await send(app, { usr: 42 }, "Danke für die Bestellung.");
await send(app, { grp: 3 }, { title: "Wartung", text: "**Sonntag** ab 20 Uhr.", format: "md" });
```

If the channel is chosen at runtime: `channel(app, "sms")?.send(app, to, msg)`, or
`userChannels(app, usrId)` for all channels that reach a user. Every `send` writes the journal
itself; never call `record()` for outgoing messages.

## Journal

`record(app, message, deliveries)` stores one message plus one row per recipient, so "sent to the
group" is one entry, but each member has their own result. `error` on a delivery is the result —
null means delivered.

```ts
const { id, ids } = await record(app, { channel: "sms", direction: "out", grpId: 3, msg, data: { to } }, [
  { usrId: 7 },
  { usrId: 9, error: "rejected" },
]);
```

Record first, then send: a tracked link needs the delivery id before the message is written. `ids`
are the delivery rows in the given order. `delivered(app, ids[i], error)` stores the outcome of
each attempt; plain success needs no write.

`msg` is the channel-independent part and goes into the `title` and `text` columns, so the journal
can be read and searched without knowing any channel. `data` holds the channel's own payload and
routing. A message without text (a code, a link) simply has none.

`messages(app, limit)` and `userMessages(app, usrId, limit)` read it with the deliveries nested.
`channel` is a plain string, so it survives module renames.

## One form for every channel

```ts
send(app, to, msg): Promise<number>   // number of destinations reached
```

`to` is `{ grp }`, `{ usr }` or `{ all: true }` for every channel, plus channel-specific
destinations. Selectors add up: `{ grp: 3, usr: [7, 9] }` reaches the group *and* those two, each
once. `usr` takes one or many; `grp` only one, because an unsubscribe link names the group to leave.

| Modul | `to` |
| --- | --- |
| messaging.email | `{ grp?, usr?, all?, email? }` |
| messaging.sms | `{ grp?, usr?, all?, phone? }` |
| messaging.telegram | `{ grp?, usr?, all?, chat? }` |
| messaging.webpush | `{ grp?, usr?, all?, channel?, client?, sub?, notClient? }` |

`email` and `phone` are the destination itself (an address, an E.164 number), verified or not. If
it matches a verified contact, the delivery is recorded for that user. `chat` and `sub` are rows in
the channel's own table, since a Telegram chat or push endpoint only exists once linked.

`msg` is `{ text, title?, format?, … }`; a plain string is short for `{ text }`. Only `text` is
required. Channels that need a title use `titleOf(msg)`, which falls back to the first line of the
text, so `send(app, { usr: 42 }, "…")` works everywhere. Other fields belong to the channel: `tag`
and `actions` for Web Push, `replyTo` for mail. Transport details are not among them — Telegram's
`parse_mode` follows from `format`.

What a channel can't show, it adapts: a `title` becomes the first line of an SMS, bold in
Telegram, the subject of a mail, the heading of a notification.

## Format

`format` says what the text *is*, not how it is delivered:

```ts
send(app, to, "plain text")                                  // sent exactly as written
send(app, to, { text: "**shipped**", format: "md" })         // markup where a channel has it
send(app, to, { text: "<p>…</p>", format: "html" })          // a document, mail only
```

Two functions serve all channels; no channel converts anything itself:

| | |
| --- | --- |
| `textOf(msg)` | plain text — markdown flattened, html converted; links keep their address |
| `htmlOf(msg, profile?)` | the markup, or `undefined` for plain text |

`profile` limits the markup to what a channel supports: `telegram` has no headings, lists or
paragraphs, so they become bold lines, bullets and blank lines — a few renderer overrides on
[marked](https://marked.js.org), which parses both profiles.

Raw html inside markdown is rendered as *text*, not markup. And markdown output still goes through
the sanitizer, so links only keep `http`, `https`, `mailto` and `tel`.

For html, `textOf` uses a real parser: comments (also conditional ones), scripts, styles and hidden
content are removed, blocks become line breaks, lists are numbered, table cells keep their columns,
and links keep their address — a text version without URLs is useless.

A mail goes out as written. Narrower targets are sanitized: `sanitizeHtml(html, "telegram")` keeps
Telegram's documented subset, because Telegram *rejects* unknown tags — one `<img>` and the message
fails. Also use `sanitizeHtml(html)` when displaying journal HTML, since anyone could have sent it.

## The way out

```
send(app, to, msg)
 ├ recipients …………………… who `to` means: addresses, chats, endpoints
 ├ record() ……………………… the message and its delivery rows; before tracked channels send
 ├ renderer(…) ………………… once per message:
 │   ├ load the template … the one the message names, else the channel's main one
 │   ├ rewriteLinks(msg) … make every address absolute, then shorten it
 │   ├ rewriteLinks(tmpl)   same for the template's links
 │   ├ beacon ……………………… a shortened tracking pixel, where markup allows
 │   └ uses ………………………… which declared placeholders this message uses
 ├ render(recipient) …… once per recipient:
 │   ├ placeholders ……… each module computes its own for this recipient
 │   ├ textOf / htmlOf …… the message as text and, if it has markup, as html
 │   ├ fill() ……………………… insert every placeholder in the right form
 │   └ markers(deliveryId)  `${link}/${marker}` on every shortened address
 ├ deliver ………………………… the channel's transport, one batch at a time
 └ delivered(id, error) … only when the attempt has its own result
```

Everything above "render(recipient)" runs once per message; everything below it once per delivery.

## Links

Every address in a message is made absolute and, if [shorturl](../shorturl/) is linked, replaced by
a short code — once per message, not per recipient. Three links to ten thousand people are three rows.

```
[shop](/shop)  →  [shop](https://site.test/s/Ab3-x9Qm/1f4c)
```

Absolute like in a browser: `/shop` is relative to the host, `shop` to the page. Absolute addresses
stay as they are; `mailto:`, `tel:`, `cid:` and `#anchor` are not touched. Addresses are found by
the parser of the format, not a regex, so a link inside a code block is left alone. The template's
links are handled the same way.

One exception stays long: an own link with a `sig` (from `grant.sign()` on
`dbFile.url({ grant })`). The signature *is* the secret; an eight-character short code would be much
easier to guess, and every guessed code opens *some* document. Only for our own host — elsewhere a
`sig` may mean anything.

## Tracking

The code identifies the address; what follows identifies the delivery:

```
https://site.test/s/Ab3-x9Qm/1f4c
                   └ address    └ delivery 1704 · c=click · signature
```

`message_track` stores one row per hit — `delivery_id`, `code`, `kind`, `time` — so "who clicked",
"which link works" and "how often" are simple queries. `kind` separates clicked links from loaded
images. `load` is always too high, because Apple Mail and Gmail's proxy fetch images nobody saw.

Every markup message gets a beacon: a transparent pixel at the end of the html, shortened and
marked like any link, so an open is just one `load` row. It is served from `messaging/open.gif`,
never cached. Plain-text and Telegram messages have none — they load no images.

The marker is signed; otherwise anyone could count through delivery numbers and fake clicks.
Three characters leave one chance in 262 144. Invalid markers are silently ignored: any module may
shorten links, so a marker this key can't read may simply belong to someone else. Nothing is stored
until a link is followed.

[cms.backend.superuser.messaging](../cms.backend.superuser.messaging/) shows opens and clicks per
recipient and link. Without shorturl a code is shown as is.

Every channel passes the delivery id to the renderer. Email and SMS go to one address, Telegram to
one chat, Web Push to one browser subscription, so each tracked link identifies the real
destination.

## Templates

A template wraps every message of a channel — the signature under a mail, the support line after an
SMS. The message picks one by name; each channel has its own variant:

| `name` | `channel` | `main` | `format` | `text` |
| --- | --- | --- | --- | --- |
| letter | email | ✓ | md | `Hallo {{givenName\|Kunde}},`<br>`{{content}}`<br>`Ihr Team` |
| signature | sms | ✓ | | `{{content}}` `Fragen? https://…` |
| newsletter | email | | md | `{{content}}`<br>`[abmelden](…)` |

`{{content}}` is the message, already rendered for the channel. All other placeholders are declared
by modules, keyed by the name between the braces:

```ts
export const templatePlaceholders: Record<string, Placeholder> = {
  ...columns({ givenName: "given_name", familyName: "family_name", organization: "organization", email: "email", address: "address" }),
  unsubscribe: placeholder,
};
```

messaging's own placeholders are written bare; other modules' use the module name:
`{{identity.name}}`, `{{identity.contact.telephone}}`. So the site's address doesn't clash with the
recipient's `{{email}}`.

A `Placeholder` returns a value per recipient. `{ text }` is escaped by the renderer; `html` is only
needed where markup differs, e.g. a link. No value leaves it empty, and `{{givenName|Kunde}}` then
uses its fallback.

Only declared names work; unknown names show their fallback. Any module can add placeholders, and
only those a text actually uses are computed — an expensive one (e.g. a signature) costs nothing
when unused.

```ts
send(app, { grp: 3 }, "wie gehts")                            // the channel's main template, if any
send(app, { grp: 3 }, { text: "…", template: "newsletter" })  // this one
send(app, { grp: 3 }, { text: "…", template: null })          // none
```

The template output is cleaned up — trailing spaces removed, at most one blank line in a row — since
empty placeholders leave gaps, and on SMS every character costs. The message text itself is never
changed: without a template it goes out as written.

`main` marks the default template per channel (like `usr_contact.main` for addresses);
`saveTemplate()` moves the flag. A channel without a main template sends none — that keeps SMS at
one segment. The template is applied per recipient and not stored in the message: the journal keeps
the original text plus the template *name*, so templates can change without rewriting history, and
searching finds messages, not signatures.

`renderer(app, msg, channel, profile?)` loads the template once and returns `{ render, uses }`, so a
mail to a thousand people costs one query. `render(to)` renders for one recipient; `uses` lists the
placeholders the message uses, so a channel can add what they need.

## Unsubscribing

`{{unsubscribe}}` is a link in html and the plain address in text. It removes the recipient from
the group the message was sent to. The link is signed, not stored: otherwise a newsletter to ten
thousand people would need ten thousand rows, and last year's link must still work.

**A GET only asks; only a POST unsubscribes.** Mail clients, scanners and link previews fetch
links, and that must not unsubscribe anyone.

**Only recipients reached via the group get one.** `{ grp: 3, usr: 7 }` reaches user 7 even if they
are not in group 3; for them the placeholder stays empty and no header is added.
`unsubscribeGroup()` checks this once per send.

**The template decides whether a message can be unsubscribed**, not "it went to a group" — admins
messaged via the admin group must not remove themselves. Where the placeholder appears, the channel
adds what it needs — for mail the `List-Unsubscribe` and `List-Unsubscribe-Post` headers, via
`uses`. That URL is never shortened: one-click unsubscribe is a POST, and a redirect would lose it.

## Not decided yet

**Can a message be reproduced?** The journal stores only the template name, so changing a template
changes how old messages look. Options: immutable template versions, or storing the rendered text
in `message_delivery.body`. Both postponed; `body` becomes necessary once recipient placeholders
make every delivery different.

## Channels

A module offers a channel by exporting `messagingChannel` from its plugin, like
[serviceworker](../serviceworker/) and the backend dashboard collect declarations:

```ts
export const messagingChannel: Channel = {
  name: "sms",          // value of the journal's channel column
  label: "SMS",
  color: "--green",     // badge colour, optional
  contact: "phone",     // kind of address it delivers to, if one is entered
  profile: "telegram",  // only if the channel supports a subset of markup
  reach: (app, usrId) => Promise<number>,   // number of destinations this user has
  recipients,           // resolves a `to` for this channel
  send,                 // the module's typed send()
  deliver,              // sends a batch; everything before is shared by all channels
};
```

`channels(app)` lists all, `channel(app, name)` picks one, `userChannels(app, usrId)` returns those
that can reach a user.

[cms.backend.superuser.messaging](../cms.backend.superuser.messaging/) shows the journal per user
and replies over any reachable channel; `auth.otp` builds its factors from the same list. Neither
knows a channel by name.

Channels: [messaging.email](../messaging.email/), [messaging.sms](../messaging.sms/),
[messaging.telegram](../messaging.telegram/) and [messaging.webpush](../messaging.webpush/).

### Whose fault a failure was

A delivery can fail for two different reasons. The address may be dead — bounced mailbox,
disconnected number — which is noted on the contact and shown as a warning in
[cms.backend.users](../cms.backend.users/). Or *we* could not send: no provider, no connection,
wrong credentials, rate limit. That says nothing about the address, so the channel throws
`ChannelError` and the contact is left alone.

```ts
if (!type) throw new ChannelError("messaging.sms: configure provider.type or call setProvider()");
```

Both land in the journal, and the type decides whether the outbox retries.

## Outbox

`message_delivery` itself tracks what still has to be sent — no second table:

| `due` | `sent` | `attempts` | |
| --- | --- | --- | --- |
| `null` | `null` | `0` | held back until released |
| `n` | `null` | | due from `n` |
| `null` | `n` | | sent |
| `null` | `null` | `> 0` | given up |

Releasing is up to the caller: a backend button sets `due` to now, a schedule sets a time, an
approval rule sets it when satisfied. `messaging` only asks what is due.

`delivered(app, id, error?, ref?)` finishes one attempt. On `ChannelError` the delivery is retried
after one, then four minutes, and given up after three tries; other errors are final. The `outbox`
cron job takes what is due and runs the same path as `send()` (the diagram above, from
`recipients`). One path only, so retries behave exactly like the first send, and a batch shares its
connection and rate limit.

`deliver()` gets the full message back. `record()` stores the common fields in columns and the rest
of `msg` in `data.msg` (a mail's `replyTo`, a push `url` or `icon`); the outbox merges them again.
So new channel fields survive the wait automatically.

## Verifying a contact

A phone number or address is only a claim until the owner proves it — anyone can type someone
else's. Telegram and Web Push don't need this: a `chat_id` only comes from a real update, an
endpoint only from the browser.

```ts
const code = await requestCode(app, "phone", usrId, "+41791234567");  // start or resend
await redeemCode(app, "phone", usrId, "+41791234567", code);          // throws if wrong
```

Open claims are in `usr_contact_verification` **only**; proven ones move to core's `usr_contact`.
So `SELECT * FROM usr_contact WHERE usr_id = 22` is always safe — no `WHERE verified IS NOT NULL`
to forget.

`usr_contact` belongs to [core](../core/docs/db.md): how a person is reached is part of the user,
and `usr.contacts.add("email", "a@b.ch")` works without messaging. This module only does the proof,
since only a channel can deliver the code.

Both tables are keyed by the **kind** of address (`phone`, `email`), not the channel. One number
serves sms, whatsapp and signal and should be verified only once. A channel names its kind in
`contact`; Telegram and Web Push have none, since their destinations are linked, not typed.

Core defines what a kind means: `contactKey(type, address)` returns the normalized form or throws.
`0041 79 123 45 67` and `+41 79 123 45 67` are the same contact, and so are `Kim@Example.com` and
`kim@example.com`. All input goes through it, so formatting never creates duplicates or claims that
can't be redeemed.

A claim ends when redeemed or expired. A wrong code does not end it, but adds to the account's
growing wait (counted in core with all other failed proofs). Codes last ten minutes, can be resent
once a minute, and only a keyed hash is stored. One open claim per user, address and kind; the
resend limit counts per address across users. `pendingContacts(app, type, usrId?)` lists open
claims; `dropClaim(app, type, usrId, address)` accepts one without code (admin action).

## Storage

`message` — one row per message; `data` is the channel's own payload as JSON.

`message_delivery` — one row per recipient, with attempt time and error. `address` is where it
really went; `usr_id` is set only if that address is a verified contact of the user, so the journal
never claims a delivery to someone based on an unverified address. `ref` is the other side's id for
it — a mail's `Message-ID`, a Twilio `sid`, a Telegram message. Ids that are only unique within a
provider or chat get a prefix (`twilio:SM…`, `<chat>:<message>`), so they are never ambiguous.

`message_attachment` — ordered links from a message to core's `file` table. Channels decide whether
they can send attachments.

`message_track` — one row per hit on a tracked link: delivery, code, click or load, time.

`usr_contact_verification` — open claims by kind, address and user. Expired rows are removed
whenever a code is requested; no cron job.

## Possible extensions

- **Contact fan-out.** Email and SMS pick one preferred contact per person; Telegram and Web Push
  reach every linked chat or browser. Decide whether email/SMS should reach all verified addresses
  before this becomes a user setting.
- **`notify(app, usrId, msg)`** over the user's channels with per-user preferences — the channel
  list exists, a preference table is missing.
- **Raw destinations.** `send(app, "+41791234567", msg)` for people without an account.
  `message_delivery.address` is ready; the channels don't accept the short form yet. Never expose
  this through an api tree — it would be a spam relay.
- **Placeholders in the message itself.** Today only templates have them: the message text goes in
  as `{{content}}` unchanged, and titles are never filled. Both could support simple declared
  placeholders — but not computed ones like `{{unsubscribe}}`, which must stay in admin-written
  templates, not in text that may come from a web form.
- **`vars` instead of string concatenation.** `send(app, to, { text: "{{name}} asks: {{message}}", vars })`
  — caller values filled in the same single pass, so a `{{…}}` inside a value stays text. Building
  a message from form input and then expanding placeholders is like string-built SQL; `vars` avoids
  that, and its presence is a better switch than a flag. Filling runs once, never recursively —
  that is what makes it safe.
