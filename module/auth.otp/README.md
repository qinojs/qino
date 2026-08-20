# auth.otp — a one-time code to a channel

Six digits over a channel the user can already be reached on: SMS, e-mail, Telegram, Web Push. The
standard calls this an *out-of-band authenticator*, as opposed to [auth.totp](../auth.totp/), where
nothing is delivered and both sides compute the same code from a shared secret.

## One factor per channel, derived

`authFactors` is a function of the app, not a list: every channel
[messaging](../messaging/) knows about becomes a factor, because a channel that can reach a person
can carry a code to them. `Channel.reach()` is already the question `Factor.has()` asks, so a
channel nobody has set up is never offered, and a `messaging.*` module that is not installed
contributes nothing.

They stay separate factors rather than one `otp`, because `via` records *what* proved a session and
the channels are not equally strong: e-mail does not stack with password reset, SMS has SIM
swapping, Telegram has neither.

## No enrolment of its own

Nothing is set up here. The channel is the enrolment, and verifying a contact is
[messaging](../messaging/)'s job — `usr_contact` holds verified addresses only, a chat id comes from a
real update, a push endpoint from the browser itself. Which means **adding a contact is an
enrolment path for a factor** and needs the same protection as one.

## The code

Straight from [messaging/lib/verify.ts](../messaging/lib/verify.ts), which already had every part:
six digits from `crypto.getRandomValues`, hashed with an app secret, ten minutes, sixty seconds
between requests, single use. What makes a static six-digit code safe at all is that wrong tries
cost the account a growing wait — unlike a TOTP, it is not implicitly bounded by a time window. That
wait is core's and shared: guesses spent here also slow down the password and the authenticator app,
so nobody gets a fresh budget by switching factor.

Never to the device that is asking. A code arriving where it is typed proves nothing beyond holding
this browser, which the request already showed — so `send()` passes the request's client as
`notClient`, and `has()` asks `reach()` the same way, or the factor would be offered with nowhere to
send. Only `webpush` can be the asking device; sms, mail and telegram are out of band by nature and
ignore it. A user whose only subscription is the browser they log in from therefore has no webpush
factor, which is the honest answer.

The claim is keyed `otp:<channel>` on the user's own id, not on the address: the contact is verified
already, so what the code proves is presence, not ownership — and it must not collide with a pending
claim on the same address.

## Api

| Verb | What it does |
|---|---|
| `POST auth.otp/<channel>` | send a code |
| `POST auth.otp/<channel>/verify` | redeem it, which writes the proof into the session |

No `login` yet: a code can only be requested for a user the request already knows, and a login does
not until it can ask for a second factor.
