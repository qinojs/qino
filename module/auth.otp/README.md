# auth.otp — a one-time code to a channel

Six digits sent over a channel the user already has: SMS, e-mail, Telegram, Web Push. An
*out-of-band authenticator* — unlike [auth.totp](../auth.totp/), where nothing is sent and both
sides compute the code from a shared secret.

## One factor per channel, derived

`authFactors` is a function of the app: every [messaging](../messaging/) channel becomes a
factor. `Factor.has()` uses `Channel.reach()`, so a channel the user hasn't set up is never
offered, and a missing `messaging.*` module adds nothing.

They are separate factors, not one `otp`, because `via` records *what* proved a session and the
channels differ in strength: e-mail is also the password-reset path, SMS has SIM swapping,
Telegram has neither. All are `second`: a code can only go to a user the request already knows.

## No enrolment of its own

Nothing to set up here. The channel is the enrolment, and verifying contacts is the job of
[messaging](../messaging/) — `usr_contact` holds only verified addresses, a chat id comes from a
real update, a push endpoint from the browser. So **adding a contact adds a factor** and needs the
same protection.

## The code

From [messaging/lib/verify.ts](../messaging/lib/verify.ts): six digits from
`crypto.getRandomValues`, hashed with an app secret, valid ten minutes, sixty seconds between
requests, single use. A six-digit code is only safe because wrong tries cost a growing wait. That
wait is core's and shared with password and authenticator app, so switching factor gives no fresh
budget.

Never sent to the device that asks: a code arriving where it is typed proves nothing new. So
`send()` passes the request's client as `notClient`, and `has()` does the same with `reach()`.
Only `webpush` can hit the asking device; sms, mail and telegram ignore it. A user whose only push
subscription is the browser they log in from has no webpush factor.

The claim is keyed `otp:<channel>` on the user id, not the address: the contact is already
verified, the code proves presence, and it must not collide with a pending verification of the
same address.

## Api

| Verb | What it does |
|---|---|
| `POST auth.otp/<channel>` | send a code |
| `POST auth.otp/<channel>/verify` | redeem it, which writes the proof into the session |

Codes can only be requested for a user the request already knows — signed in, or a login under
way.
