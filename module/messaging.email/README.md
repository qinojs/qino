# messaging.email

Email channel: sends over any [Upyo](https://upyo.dev) transport, receives over IMAP; both land
in the messaging journal. Channel name: `email`.

## Sending

```ts
import { send } from "@qino/qino/messaging.email";

await send(app, { usr: 42 }, "Your order shipped.");
await send(app, { email: "someone@example.com" }, { title: "Invoice", text: "…", format: "md" });
```

Recipients: `{ grp }`, `{ usr }`, `{ email }` (one or many), `{ all: true }`. Users without an
address are skipped. An address that belongs to a user is recorded as theirs, so it shows up in
their conversation. Selectors add up; an invalid address is recorded as failed without blocking the
others.

The subject is `title`, or the first line of the text. `md` and `html` mails get an HTML part plus
a plain-text alternative; plain text goes out as text only.

`replyTo` overrides the inbound address — e.g. a contact form's reply goes to the person who filled
it in, not to the site.

## Verification

Like [messaging.sms](../messaging.sms/#verification), with `address` instead of `number`:
`POST messagingEmail/emails` with `{ address }` mails a six-digit code, `POST messagingEmail/emails/verify`
with `{ address, code }` makes it the user's; `GET messagingEmail/emails`, `PUT …/email/<address>/main`
and `DELETE …/email/<address>` complete it. [cms.cont.my.emails](../cms.cont.my.emails/) provides this
flow to signed-in users.

## Receiving

`address` is the system address and sender. `inbound.address` defaults to it; if different, it is
sent as `Reply-To`. So replies arrive in a mailbox this module reads, in the same conversation.

With `inbound.enabled`, the cron job `messaging.email.inbox` checks the mailbox every five minutes
over IMAP ([imapflow](https://www.npmjs.com/package/imapflow) +
[mailparser](https://www.npmjs.com/package/mailparser), loaded only when a host is configured).
Each message is recorded as `direction: "in"` and assigned to the sender's user; mailbox flags stay
unchanged. A cursor per mailbox (`email_inbox`) fetches only newer mail, the first run the whole
mailbox; a mail failing three times is skipped. `email_receipt` keeps a hash of every imported mail,
so a mail deleted from the journal is not imported again, even when the server renumbers.

Each incoming mail gets a `spam` score (0 to 1): the receiving server's verdict (`Authentication-Results`:
DMARC/SPF/DKIM `fail`, and an `X-Spam-Flag`/`X-Spam-Status`/`X-Spam` saying yes) and security's
`spamScore`; with ai, a model judges the content. A known sender — the address of a user, or one
mailed before — is judged too, since an account can be taken over; the model is only told.

## Settings

| Key | Meaning |
| --- | --- |
| `address`, `name` | Required system address and optional From display name |
| `debugTo` | Redirects every outgoing mail here, subject prefixed `Debug!`; the journal marks every delivery as not reached |
| `inbound.enabled` | Enables mailbox polling |
| `inbound.address` | The address the app receives on; defaults to the system address |
| `inbound.host`, `.port`, `.secure`, `.user`, `.pass`, `.mailbox` | IMAP access; host, user and password inherit from SMTP where possible; defaults are 993, direct TLS and INBOX |
| `transport.type` | Defaults to `smtp`; alternatives are `mailgun`, `resend`, `sendgrid`, `ses`, `plunk`, `jmap` and `mock`; SMTP defaults to port 465 |

Own transport: `setTransport(app, transport)`. `receive(app)` reads the mailbox on demand.

If the template uses `{{unsubscribe}}`, the mail gets `List-Unsubscribe` and
`List-Unsubscribe-Post` headers for one-click unsubscribe — see
[messaging](../messaging/#unsubscribing).

## Still missing

- **Mail options:** per-message sender, headers, tags and priority. **No cc/bcc**: a copy is
  nobody's delivery and would have no journal row.
- **Bounces:** parse returned mails, store the reason on the delivery and mark the address. Only
  worth it if the mailbox keeps the original `Return-Path`; guessing the delivery is worse than
  not knowing.
- **Drafts:** save a draft, add recipients later. (Retrying failed deliveries is done by the
  messaging [outbox](../messaging/#outbox).)
- **Custom rendering:** recipient data in subject and body, and templates in code.

Templates themselves already live in messaging and are used by this channel.

## Attachments

Attachments are part of the common message, but only email delivers them. Pass a `File` or
`{ name, type?, content }` (`content`: text, bytes or `Blob`). The journal stores them as core
`DbFile`s. No inline/CID images — images are linked by address, which messaging makes absolute.
