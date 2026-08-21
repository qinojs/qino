# messaging.email

Email as a messaging channel: it sends over any [Upyo](https://upyo.dev) transport and receives
over IMAP, and both directions land in the messaging journal.

This module is the successor of [mail](../mail/), which it replaces step by step. The two run in
parallel and keep their settings apart — `messaging.email.*` here, `mail.*` there. `mail` no longer
declares a messaging channel, so `email` is this module's name alone.

## Sending

```ts
import { send } from "@qino/qino/messaging.email";

await send(app, { usr: 42 }, "Your order shipped.");
await send(app, { email: "someone@example.com" }, { title: "Invoice", text: "…", format: "md" });
```

Recipients: `{ grp }`, `{ usr }`, `{ email }` (one address or many), `{ all: true }`. A user
without an address drops out, and an address that turns out to belong to a user is journaled as
that user's, so a mail to a literal address still shows up in their conversation.

The subject is the message's `title`, or the first line of its text when it has none — the same
rule every channel follows. `format` decides the body: `md` and `html` mails carry an HTML part
plus the plain-text alternative every mail needs, plain text goes out as text alone.

## Receiving

`inbound.address` is the address the app receives on, and it is what outgoing mail carries as
`Reply-To` unless `reply_to` says otherwise. That is the whole point of configuring it: a reply
comes back to a mailbox this module reads, and lands in the same conversation as everything else.

The cron job `messaging.email.inbox` polls the mailbox every five minutes over IMAP
([imapflow](https://www.npmjs.com/package/imapflow) + [mailparser](https://www.npmjs.com/package/mailparser),
both loaded only once a host is configured). Every message it takes over is journaled as
`direction: "in"`, tied to the user whose address it came from, and marked `\Seen`. Seen is the
only bookkeeping: a message the app crashed on stays unseen and arrives with the next run.

## Settings

| Key | Meaning |
| --- | --- |
| `sender`, `sendername` | Default From |
| `reply_to` | Overrides the inbound address as Reply-To |
| `debug_to` | Redirects every outgoing mail here, subject prefixed `Debug!`; the journal marks every delivery as not reached |
| `inbound.address` | The address the app receives on |
| `inbound.host`, `.port`, `.secure`, `.user`, `.pass`, `.mailbox` | IMAP access; without a host nothing is received |
| `transport.type` | `smtp`, `mailgun`, `resend`, `sendgrid`, `ses`, `plunk`, `jmap`, `mock` |

Without a configured transport a dev app falls back to `mock`; a production app refuses to send.
An app that brings its own transport injects it with `setTransport(app, transport)`, and `receive(app)`
fetches the mailbox on demand.

## Still missing compared with mail

- **Mail options:** cc/bcc, per-message sender and reply-to, headers, tags and priority.
- **Durable delivery:** save a draft, add recipients and resend pending or failed deliveries.
  The old module permits this manually; an automatic retry queue does not exist yet and belongs
  to messaging rather than email.
- **Opens:** the pixel every mail used to carry. Followed links are tracked
  ([messaging](../messaging/#tracking)); a mail without images reports no open at all.
- **Custom rendering:** recipient data inside subject and body, and programmatic templates.

Templates themselves already live in messaging and are used by this channel.

## Attachments

Attachments belong to the common message and are currently delivered by email only. Pass a `File`
or `{ name, type?, content }`, where `content` is text, bytes or a `Blob`. Other channels currently
do not deliver them. The journal stores attachments as core `DbFile`s. Inline/CID images are not
implemented and not planned — an image goes in by its address, which messaging makes absolute.
