# messaging.sms

SMS delivery plus verified phone numbers. `usr_contact` stores several E.164 numbers per user;
a number belongs to one user only.

## Sending

```ts
import { send } from "@qino/qino/messaging.sms";

await send(app, { usr: 42 }, "Your order shipped.");
await send(app, { grp: 3 }, { title: "Notice", text: "The building closes at 18:00." });
await send(app, { phone: ["+41791234567", "+41797654321"] }, "Direct notice");
```

An SMS is text and nothing else, so a `title` becomes its first line.

Recipients: `{ grp }`, `{ usr }`, `{ phone }` (one or many) or `{ all: true }`. Users, groups and
`all` reach one number per person: the main one, else the oldest. `{ phone }` accepts any common
notation, verified or not; a number that belongs to a user is recorded as theirs. Selectors add up;
an invalid number is recorded as failed without blocking the others. Returns the number of
successful deliveries; a provider error is stored on the phone row until the next success.

## Providers

Set `messaging.sms.provider.type` to `twilio` or `http`. Twilio needs the Account SID, ideally an
API Key SID/secret (else the Auth Token), and `from` or a `messagingServiceSid`. The HTTP provider
posts this JSON to the configured URL:

```json
{ "to": "+41791234567", "text": "Hello", "from": "Qino" }
```

`token`, if set, is sent as Bearer token. Any other API can be plugged in per app:

```ts
import { setProvider } from "@qino/qino/messaging.sms";

setProvider(app, {
  send: (to, text) => vendor.messages.create({ to, text }),
});
```

## Verification

The authenticated API flow is:

1. `POST messagingSms/phones` with `{ number }` claims it and sends a six-digit code.
2. `POST messagingSms/phones/verify` with `{ number, code }` turns the claim into a number of theirs.
3. `PUT messagingSms/phone/<number>/main` selects the main number.
4. `GET messagingSms/phones` lists `{ phones, pending }`; `DELETE messagingSms/phone/<number>` removes one.

The number is the identity before and after verification. **`usr_contact` holds verified numbers
only**, as `type: "phone"` (not "sms"), so WhatsApp or Signal could use the same rows. Pending
claims, codes and limits are handled by [messaging](../messaging/#verifying-a-contact). Numbers
are normalized to E.164 first, so two notations are one claim.

Reading and changing numbers is done with core functions: `contacts(db, usrId, "phone")`,
`setMainContact`, `removeContact`, `contactKey("phone", input)` — the same calls work for
`"email"`.

[cms.cont.my.phones](../cms.cont.my.phones/) provides this flow to signed-in users.
[cms.backend.superuser.messaging.sms](../cms.backend.superuser.messaging.sms/) configures providers, sends messages
and may approve a pending number without its code.
