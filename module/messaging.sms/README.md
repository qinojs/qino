# messaging.sms

Minimal SMS delivery plus verified phone numbers for users. `usr_phone` stores multiple
E.164 numbers per user; one number belongs to only one user.

## Sending

```ts
import { send } from "../messaging.sms/mod.ts";

await send(app, { usr: 42 }, "Your order shipped.");
await send(app, { grp: 3 }, "The building closes at 18:00.");
```

Recipients are `{ grp }`, `{ usr }`, `{ phone }` or `{ all: true }`. User, group and broadcast
delivery uses each user's verified main number. A sole verified number is selected automatically;
`{ phone }` deliberately addresses one verified row directly. The result is the number of
successful deliveries; a provider error is retained on the phone row and cleared after the next
successful delivery.

## Providers

Set `messaging.sms.provider.type` to `twilio` or `http`. Twilio needs the Account SID and
preferably an API Key SID/secret (the account Auth Token remains a fallback), plus either
`from` or a `messagingServiceSid`. The generic HTTP provider sends this JSON to the configured URL:

```json
{ "to": "+41791234567", "text": "Hello", "from": "Qino" }
```

When `token` is set it is sent as a Bearer token. An application can support any SDK or API
without changing this module by injecting a provider per app:

```ts
import { setProvider } from "../messaging.sms/mod.ts";

setProvider(app, {
  send: (to, text) => vendor.messages.create({ to, text }),
});
```

## Verification

The authenticated API flow is:

1. `POST messagingSms/phones` with `{ number }` sends a six-digit code.
2. `POST messagingSms/phone/<id>/verify` with `{ code }` verifies it.
3. `PUT messagingSms/phone/<id>/main` selects the main number.
4. `GET messagingSms/phones` lists the user's numbers; `DELETE messagingSms/phone/<id>` removes one.

Numbers are normalized to E.164. Codes expire after ten minutes, sending is limited to once
per minute per pending number, and five failed attempts invalidate a code. Only a keyed hash
of the code is stored.

[cms.cont.my.phones](../cms.cont.my.phones/) provides this flow to signed-in users.
[cms.backend.superuser.sms](../cms.backend.superuser.sms/) configures providers, sends messages
and may approve a pending number without its code.
