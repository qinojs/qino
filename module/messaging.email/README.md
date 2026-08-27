# messaging.email

Email as a messaging channel: it sends over any [Upyo](https://upyo.dev) transport and receives
over IMAP, and both directions land in the messaging journal.

This module supersedes the archived [mail](../../archiv/mail/) module; everything that sends mail
sends it here, and `email` is this module's channel name.

## Sending

```ts
import { send } from "@qino/qino/messaging.email";

await send(app, { usr: 42 }, "Your order shipped.");
await send(app, { email: "someone@example.com" }, { title: "Invoice", text: "…", format: "md" });
```

Recipients: `{ grp }`, `{ usr }`, `{ email }` (one address or many), `{ all: true }`. A user
without an address drops out, and an address that turns out to belong to a user is journaled as
that user's, so a mail to a literal address still shows up in their conversation. Selectors add
up; an invalid literal is journaled as failed without blocking the other recipients.

The subject is the message's `title`, or the first line of its text when it has none — the same
rule every channel follows. `format` decides the body: `md` and `html` mails carry an HTML part
plus the plain-text alternative every mail needs, plain text goes out as text alone.

`replyTo` on the message overrides the inbound address, for the mails whose answer belongs somewhere other
than the app's mailbox — a contact form replies to whoever filled it in, not to the site.

## Receiving

`address` is the system address and outgoing sender. `inbound.address` defaults to it; when it
differs, outgoing mail carries it as `Reply-To`. A reply therefore comes back to a mailbox this
module reads and lands in the same conversation as everything else.

With `inbound.enabled`, the cron job `messaging.email.inbox` polls the mailbox every five minutes over IMAP
([imapflow](https://www.npmjs.com/package/imapflow) + [mailparser](https://www.npmjs.com/package/mailparser),
both loaded only once a host is configured). Every message it takes over is journaled as
`direction: "in"`, tied to the user whose address it came from, and marked `\Seen`. Seen is the
only bookkeeping: a message the app crashed on stays unseen and arrives with the next run.

## Settings

| Key | Meaning |
| --- | --- |
| `address`, `name` | Required system address and optional From display name |
| `debugTo` | Redirects every outgoing mail here, subject prefixed `Debug!`; the journal marks every delivery as not reached |
| `inbound.enabled` | Enables mailbox polling |
| `inbound.address` | The address the app receives on; defaults to the system address |
| `inbound.host`, `.port`, `.secure`, `.user`, `.pass`, `.mailbox` | IMAP access; host, user and password inherit from SMTP where possible; defaults are 993, direct TLS and INBOX |
| `transport.type` | Defaults to `smtp`; alternatives are `mailgun`, `resend`, `sendgrid`, `ses`, `plunk`, `jmap` and `mock`; SMTP defaults to port 465 |

An app that brings its own transport injects it with `setTransport(app, transport)`, and `receive(app)`
fetches the mailbox on demand.

A mail whose template offers `{{unsubscribe}}` carries `List-Unsubscribe` and `List-Unsubscribe-Post`,
so the client can offer the one-click way to the same link — see
[messaging](../messaging/#unsubscribing) for why the template decides that and not "it went to a group".

## Still missing compared with mail

- **Mail options:** per-message sender, headers, tags and priority. **cc/bcc are
  not planned**: a message goes to recipients, and a copy that is nobody's delivery has no row
  in the journal to be.
- **Bounces:** a parser for the rejections that come back, writing the reason onto the delivery
  it belongs to and marking the address itself. Only worth it for a mailbox whose headers carry
  the `Return-Path` the message went out with — without it, guessing which delivery bounced is
  worse than not knowing.
- **Durable delivery:** save a draft, add recipients and resend pending or failed deliveries.
  The old module permits this manually; an automatic retry queue does not exist yet, belongs to
  messaging rather than email, and is postponed.
- **Custom rendering:** recipient data inside subject and body, and programmatic templates.

Templates themselves already live in messaging and are used by this channel.

## Attachments

Attachments belong to the common message and are currently delivered by email only. Pass a `File`
or `{ name, type?, content }`, where `content` is text, bytes or a `Blob`. Other channels currently
do not deliver them. The journal stores attachments as core `DbFile`s. Inline/CID images are not
implemented and not planned — an image goes in by its address, which messaging makes absolute.
