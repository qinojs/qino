# messaging

Three things nobody wants to build per channel: the journal of what was sent and received,
the list of ways one person can be reached, and the proof that a contact is really theirs.

## Sending

There is no `send()` here — the channel module has it, and you import the one you mean:

```ts
import { send } from "@qino/qino/messaging.email";

await send(app, { usr: 42 }, "Danke für die Bestellung.");
await send(app, { grp: 3 }, { title: "Wartung", text: "**Sonntag** ab 20 Uhr.", format: "md" });
```

Pick one at runtime instead when the channel is data — `channel(app, "sms")?.send(app, to, msg)`,
or `userChannels(app, usrId)` for whatever reaches that user at all. Every `send` journals itself;
you never call `record()` for an outgoing message.

## Journal

`record(app, message, deliveries)` stores one logical message plus one row per recipient, so
"sent to the group" stays one entry while every member keeps their own result. `error` on a
delivery is the whole verdict — null means reached.

```ts
const { id, ids } = await record(app, { channel: "sms", direction: "out", grpId: 3, msg, data: { to } }, [
  { usrId: 7 },
  { usrId: 9, error: "rejected" },
]);
```

Journal first, send after: `ids` are the delivery rows in the order they were given, and a tracked
link needs one before it can be written into the message. `delivered(app, ids[i], error)` fills in
how each attempt went — a plain success is already what the row says, so nothing is written back.

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
for Telegram, `tag` and `actions` for Web Push, `replyTo` for mail.

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
| `textOf(msg)` | plain text — markdown flattened, html walked: both keep a link's address |
| `htmlOf(msg, profile?)` | the markup, or `undefined` when the message is plain text |

`profile` narrows the markup to what a channel accepts: `telegram` has no headings, lists or
paragraphs, so those arrive as bold lines, bullets and blank lines — a handful of renderer
overrides on [marked](https://marked.js.org), which does the parsing for both profiles.

Two things stand between a message and the page it lands on. Raw html inside markdown is rendered
as *text*, not markup, because a message may only say what its own markup asks for. And what markdown
itself emits still passes the sanitizer, so of the addresses a link can carry only `http`, `https`,
`mailto` and `tel` survive.

The html side walks a real parser: comments (conditional ones included), scripts, styles and
anything hidden from the reader are gone, blocks become line breaks, lists count, table cells keep
their columns, and a link keeps its address — a plain-text alternative without the URLs is worth
nothing.

A mail client is not a page, so a document goes out as it was written. A narrower target is
sanitized on the way out all the same, for a different reason: `sanitizeHtml(html, "telegram")`
keeps its documented subset, because an unknown tag there is *refused*, not ignored — one `<img>`
and the message never goes out. `sanitizeHtml(html)` is also for the way *in*: a panel that renders
journal HTML must pass it through, because a message is written by whoever sent it.

## The way out

```
send(app, to, msg)
 ├ recipients …………………… who the `to` means: addresses, chats, endpoints
 ├ record() ……………………… the message plus its delivery rows; before tracked channels send
 ├ renderer(…) ………………… once per message:
 │   ├ load the template … the one the message names, else the channel's main one
 │   ├ rewriteLinks(msg) … every address absolute, then shortened
 │   ├ rewriteLinks(tmpl)   the template's links are traded with the message's own
 │   ├ beacon ……………………… a shortened pixel, where the markup can carry one
 │   └ uses ………………………… which declared placeholders this message names
 ├ render(recipient) …… once per recipient:
 │   ├ placeholders ……… each declaring module works its own out for this one recipient
 │   ├ textOf / htmlOf …… the message as text and, where it has markup, as html
 │   ├ fill() ……………………… every placeholder in, in the form this side needs
 │   └ markers(deliveryId)  `${link}/${marker}` on every shortened address
 ├ deliver ………………………… the channel's own transport, one recipient at a time
 └ delivered(id, error) … only when the attempt has a verdict of its own
```

Everything above the recipient line happens once, however many people are written to; everything
below it is what a single delivery costs.

## Links

Every address a message points at is made absolute and, where [shorturl](../shorturl/) is linked,
traded for a short code — once per message, never per recipient. Three links to ten thousand people
are three rows.

```
[shop](/shop)  →  [shop](https://site.test/s/Ab3-x9Qm/1f4c)
```

Absolute means what a browser means: `/shop` is the host's, `shop` is the page's. An address that
is already absolute is left exactly as it was written, and what is not a web address — `mailto:`,
`tel:`, `cid:`, a bare `#anchor` — is not touched at all. Which addresses a message names is read
by the parser of its format, not by a pattern, so one inside a code block is being *shown*, not
offered. The template is part of what goes out, so its links are traded with the message's own.

One address is deliberately left long: a link of our own that carries a `sig` — what
`grant.sign()` puts on a `dbFile.url({ grant })` — *is* the secret. Trading a hundred-odd bits for
the eight characters of a short code would make the code the weaker of the two, and every guessed
code hits *some* document. Only our own: on a foreign host a `sig` means whatever that host
decided it means.

## Tracking

What follows the code says which delivery got there; the code itself says which address:

```
https://site.test/s/Ab3-x9Qm/1f4c
                   └ address    └ delivery 1704 · c=click · signature
```

`message_track` keeps one row per hit — `delivery_id`, `code`, `kind`, `time` — so "who clicked",
"which link pulls" and "how often" are one query. `kind` tells a followed link from an image the
client loaded, which is the difference between a reader and a mail client: `load` is systematically
too high, because Apple Mail and Gmail's proxy fetch images nobody looked at.

Every markup message carries a beacon for that second kind — a transparent pixel appended to the
html, shortened and marked like any other address, so an open is one `load` row and needs no
special case. It answers from `messaging/open.gif` and is never cached; a plain-text message and a
Telegram one carry none, because neither is a page that loads images.

The marker is signed, and that is its whole point: a bare delivery number invites walking 1, 2, 3
and writing a click for somebody else. Three characters leave one guess in 262 144. A marker that
does not check out is simply not counted, and nothing is reported: the tag behind a code belongs to
whoever made the link, every module may shorten, and one this key cannot read is somebody else's
rather than a forged one. Nothing about it is stored until it is followed.

[cms.backend.superuser.messaging](../cms.backend.superuser.messaging/) shows it: opens and clicks
per recipient, and what was reached how often. A code stands for itself unless shorturl is there
to say what it means.

A message is only tracked when the channel hands the delivery's id to the renderer — email and sms
do. Telegram and Web Push shorten their links but write no marker: their delivery rows are one per
*user*, not one per device, so a marker there would say less than it seems to.

## Templates

A template is what a channel puts around every message — the signature under a mail, the
support line after an SMS. The message asks for it by name, and each channel keeps its own
variant, so the same message arrives the way that channel talks:

| `name` | `channel` | `main` | `format` | `text` |
| --- | --- | --- | --- | --- |
| letter | email | ✓ | md | `Hallo {{firstname\|Kunde}},`<br>`{{content}}`<br>`Ihr Team` |
| signature | sms | ✓ | | `{{content}}` `Fragen? https://…` |
| newsletter | email | | md | `{{content}}`<br>`[abmelden](…)` |

`{{content}}` is the message, already rendered for that channel. Everything else a template may
name is declared by a module, keyed by the name written between the braces:

```ts
export const messagingPlaceholders: Record<string, Placeholder> = {
  ...columns("firstname", "lastname", "company", "email", "address"),
  unsubscribe: placeholder,
};
```

A `Placeholder` answers per recipient and in both forms — `{ text, html }` — because what is a link
in markup is a bare address in text. Nothing back means the hole stays empty, which is how
`{{firstname|Kunde}}` falls back to the name it gives.

The registry is the allowlist: a name nobody declared reads as its fallback, so widening a query
never widens what a template can read. Any module may add its own, and only what a text actually
names is worked out — a placeholder that costs a signature is not spent on a template that never
mentions it.

```ts
send(app, { grp: 3 }, "wie gehts")                            // the channel's main template, if any
send(app, { grp: 3 }, { text: "…", template: "newsletter" })  // this one
send(app, { grp: 3 }, { text: "…", template: "" })            // none
```

What the template assembles is tidied — trailing spaces, and never more than one blank line in a row,
because a placeholder that came up empty leaves a hole and on sms a blank line costs money. The message's
own text is never touched: without a template, it goes out exactly as it was written.

`main` marks the one a message gets when it names none — one per channel, as `usr_contact.main`
marks the address a user is written to; `saveTemplate()` hands the flag over. A channel without a
main template sends without one — that is how SMS stays one segment. It is applied per recipient
and never joins the message: the journal keeps the text as it was written plus the template's
*name*, so a template can be rewritten without rewriting history, and searching the journal finds
messages instead of signatures.

Rendering is `renderer(app, msg, channel, profile?)` — it loads the template once and hands back
`{ render, uses }`, so a mail to a thousand people costs one query. `render(to)` renders for one
recipient; `uses` are the placeholders this message turned out to name, which is how a channel adds
what one of them needs from it.

## Unsubscribing

`{{unsubscribe}}` is a link in the html part and the bare address in the text part. It drops the
recipient from the group the message went to, and it is signed rather than stored: a newsletter to
ten thousand people would otherwise be ten thousand rows for a link almost nobody follows, and the
one in a mail from last year has to keep working.

**A GET only asks — nothing is dropped without a POST.** Mail clients, scanners and link previews
fetch what they find, and a fetched link must not unsubscribe anyone.

**Whether a message can be unsubscribed from is what the template says**, not "it went to a group":
four administrators who must not throw themselves out of the admin group are sent to a group too.
Where the placeholder stands, the channel adds what it needs — for mail the `List-Unsubscribe`
header plus `List-Unsubscribe-Post`, from `uses` (see below). Its url is never shortened: one-click
unsubscribing is a POST, and a redirect loses it.

## Not decided yet

**Whether a message can be reproduced.** Today the journal stores the template's name, so a
rewritten template changes how history looks. The two ways out — fixing the template (an
immutable version per name) or storing the whole rendered text in `message_delivery.body` —
are both open and both postponed. `body` becomes the honest answer the moment recipient placeholders
make every delivery a different text.

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

[cms.backend.superuser.messaging](../cms.backend.superuser.messaging/) renders the journal per user
and replies over whichever channel is reachable; `auth.otp` derives its factors from the same
registry. Neither knows a channel by name.

Channels today: [messaging.email](../messaging.email/), [messaging.sms](../messaging.sms/),
[messaging.telegram](../messaging.telegram/) and [messaging.webpush](../messaging.webpush/).
[mail](../mail/) is not one of them any more — `messaging.email` is its successor and owns the
`email` channel alone.

## Verifying a contact

A phone number or mail address is a claim until the owner proves it — anyone can type
someone else's. Telegram and Web Push need none of this: a `chat_id` comes only from a real
update, an endpoint only from the browser itself.

```ts
const code = await requestCode(app, "phone", usrId, "+41791234567");  // start or resend
await redeemCode(app, "phone", usrId, "+41791234567", code);          // throws unless it proves it
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
ten minutes, resending is limited to once a minute, and only a keyed hash is stored. One open claim
exists per user, address and kind; the resend limit applies to the address across users.
`pendingContacts(app, type, usrId?)` lists what is open, and `dropClaim(app, type, usrId, address)`
takes one as proven without its code — what an admin does.

## Storage

`message` — one row per logical message; `data` is the channel-native payload as JSON, so
nothing is lost and nothing has to be normalized.

`message_delivery` — one row per recipient, with the time it was attempted and the error, if
any. `address` is where it actually went; `usr_id` is set only when that address is a
verified contact of that user, so the journal never claims a message reached someone on the
strength of an unproven address.

`message_attachment` — ordered links from a message to core's `file` table. Content and metadata
stay in `DbFile`; channels decide whether they can deliver attachments.

`message_track` — one row per hit on a tracked link: which delivery, which code, followed or
loaded, and when.

`usr_contact_verification` — open claims, keyed by kind, address and user. No cron job: expired
rows are swept whenever a code is requested.

## Possible extensions

- **`notify(app, usrId, msg)`** across the user's channels, with per-user preferences — the
  registry is what it would need; the preference table is what is missing.
- **Raw destinations.** `send(app, "+41791234567", msg)` — a bare string as the recipient,
  for people who have no account. `message_delivery.address` is there for it; what is
  missing is the channels accepting the short form. Never expose it through an api tree: it
  is a spam relay the moment it is reachable over HTTP.
- **Placeholders in the message itself.** They work in the template alone today: the message's own
  text goes in as `{{content}}` untouched, and a title never sees `fill()` at all. Both could have
  them, but only the declared ones with no effect of their own — a computed one like
  `{{unsubscribe}}` has to keep coming from a template, which an administrator wrote, and not from
  a text that may have been assembled from a web form.
- **`vars` instead of glued strings.** `send(app, to, { text: "{{name}} asks: {{message}}", vars })`
  — the caller's own values, filled in the same single pass, so a `{{…}}` inside one of them stays
  text. Whoever builds a message out of form input and switches placeholder expansion on has destroyed
  the boundary before `fill()` ever sees it, exactly as string-built SQL does; passing values is the
  way out, and the presence of `vars` is a better switch than a flag. Filling is one round, never
  recursive — that is what makes it safe.
