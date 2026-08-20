# messaging.sms

Minimal SMS delivery plus verified phone numbers for users. `usr_contact` stores multiple
E.164 numbers per user; one number belongs to only one user.

## Sending

```ts
import { send } from "@qino/qino/messaging.sms";

await send(app, { usr: 42 }, "Your order shipped.");
await send(app, { grp: 3 }, { title: "Notice", text: "The building closes at 18:00." });
```

An SMS is text and nothing else, so a `title` becomes its first line.

Recipients are `{ grp }`, `{ usr }`, `{ phone }` or `{ all: true }`. User, group and broadcast
delivery reach one number per person: the main one, or the oldest when none was ever chosen.
`{ phone }` is the number itself in any common notation and reaches it whether or not anyone
verified it — a number that is somebody's is journaled as theirs. The result is the number of
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
import { setProvider } from "@qino/qino/messaging.sms";

setProvider(app, {
  send: (to, text) => vendor.messages.create({ to, text }),
});
```

## Verification

The authenticated API flow is:

1. `POST messagingSms/phones` with `{ number }` claims it and sends a six-digit code.
2. `POST messagingSms/phones/verify` with `{ number, code }` turns the claim into a number of theirs.
3. `PUT messagingSms/phone/<id>/main` selects the main number.
4. `GET messagingSms/phones` lists `{ phones, pending }`; `DELETE messagingSms/phone/<id>` removes one.

The number is the identity, before and after verification — a claim has no contact row yet, and
**`usr_contact` holds verified numbers only**. Everything about the pending state, the
code and its limits belongs to [messaging](../messaging/#verifying-a-contact) and is shared
with the other channels that need it. Numbers are normalized to E.164 first, so the same
number written two ways is one claim.

[cms.cont.my.phones](../cms.cont.my.phones/) provides this flow to signed-in users.
[cms.backend.superuser.messaging.sms](../cms.backend.superuser.messaging.sms/) configures providers, sends messages
and may approve a pending number without its code.
