# auth

Collects the ways a user can prove who they are, and decides what a proof is worth.

**One idea: a factor proves who you are, and where the request stands decides what that is worth.**
Signing in and confirming you are still there are the same proof in two situations, so the module
that ran the ceremony says only what it found out:

```ts
await proof(ctx, "webauthn", usrId);
```

Not signed in, that is a login and core turns the identity into a session. Already signed in as that
user, it is a fresh proof recorded in the session — a step-up. It resolves with **nothing when that
went through, otherwise with what is still missing**; an empty list means nothing here helps (an
inactive user, or a factor that may not do this).

## Declaring a factor

A module exports `authFactors` from its plugin, the way [messaging](../messaging/) collects
channels:

```ts
export const authFactors: Factor[] = [{ name: "webauthn", label: "Passkey", stepUp: true }];
```

A list, because one module may bring several ([auth.otp](../auth.otp/) has one per channel); a
function of the app when that is only known at runtime.

- `stepUp` — may also refresh an open session. A federated login leaves it out: the provider answers
  from its own session and says nothing about who is at the keyboard now.
- `second` — can only ever be the second factor. [auth.backup_codes](../auth.backup_codes/) finishes
  a login somebody else started, so a stolen code is worth nothing without the password in front.
- `order` — where it sits when several are offered, so the dialog opens the best one first. That is
  presentation, not a verdict.
- `has` — optional. A factor that cannot answer it per user counts as available for everyone.

`factors(app)` lists what linked modules declare, `userFactors(app, usrId)` what one person has.
Nothing here knows a factor by name, so a new one costs no code in `auth` and shows up in
[cms.backend.superuser.auth](../cms.backend.superuser.auth/) by itself. `core` is one of those
modules and declares `password`. Each factor brings its own `cms.cont.my.*` page for setting it up.

## A login of more than one factor

`core.loginTwoFactor` asks for a second one. The first proof then opens nothing: the identity waits
as `core.pending` in the anonymous session for ten minutes, and the rotation on the real login
clears it — no half-login table, nothing to sweep. Whoever has no second factor is let in with one.

In the browser it is the step-up dialog again: the login page loads
[`finishLogin.mjs`](../core/pub/js/finishLogin.mjs), which asks `GET core/login/missing`. The
`verify` verbs behind it take `Access.IDENTIFIED` — **whoever is signed in, or whoever a login under
way has established** (`identified(ctx)` in server code). That is also why a code can be sent at
all: only ever to a user the request already knows.

## What guessing costs

The account is the subject, never the method
([attempts.ts](../core/lib/auth/attempts.ts)): `beforeProof()` stands in front of every check of
something guessable, `proofFailed()` makes the next one dearer, `proofPassed()` wipes the slate.
Three free tries, then a wait doubling to five minutes, forgotten after an hour. A counter per
factor would let an attacker spread guesses over password, totp and backup codes.

A wait and not a lockout: a lockout is a weapon anyone who knows an e-mail address can fire.
The slate is wiped when a login is **finished**, not when a factor lands — otherwise whoever knows
the password buys a fresh budget for guessing the second one with every correct entry.
[auth.webauthn](../auth.webauthn/) does not count at all: a signature is not guessed.

## Demanding a fresh proof

[`requireStepUp(ctx, { maxAge })`](../core/lib/auth/factors.ts) throws `StepUpError`
(`code: "step_up_required"`, plus the factors that would work for this user). It counts only what a
module declares with `stepUp`, so `remember` and `login_as` never satisfy one.

A verb that always needs one says so, and [`invoke()`](../core/lib/api/invoke.ts#L98) asks on its
behalf, once the gates have passed and before `execute` runs:

```ts
requireStepUp: true,             // always
requireStepUp: { maxAge: 60 },   // always, and sooner
```

Where it depends on the call it goes in the `guard` — that sees the path params and the validated
input, and runs before anything happens, which matters because the browser repeats the same request
after the dialog:

```ts
guard: ({ amount }, ctx) => amount <= 1000 || requireStepUp(ctx, { maxAge: 60 }),
```

The field is not shorthand for that: it is the only form a listing can see, which is how
[`mcp`](../mcp/) can leave those verbs out — a Bearer token identifies a request, not a session, so
a stateless caller could never answer. Every way a factor is handed out or taken away carries it,
because whoever issues a factor changes what counts as a proof from then on.

A route is not a verb and cannot demand anything (a `StepUpError` would land as a 403 page):
`oauth/start/<name>` therefore has the connect button call `POST auth.oauth/connect` first, and
spends that note.

Whoever has no factor at all passes — a demand nobody can meet protects nothing and would only lock
someone out of setting up their first factor. The dry run (`x-api-check: access`) asks who *may*
use a verb and demands nothing either.

In the browser, [`ApiClient`](../core/pub/js/ApiClient.js) only offers `recover(error)`: a hook that
may fix a failed request and send it **once** more. The dialog knows no factor by name — each ships
a `pub/stepup.js` exporting `prove(root)`, and the error says which module to import it from.

## What a proof is not

**Not a permission.** `access` and `guard` decide whether a user may do something at all; a proof
only says the person is there right now.

**Not a recovery mechanism.** A link is a [ticket](../ticket/), a one-time code is an ordinary
factor.

**Not only a record of proofs.** The session keeps `core.via.<name> = <when>` for every way in,
including ones that prove nothing (`remember`, `login_as`). They are auditable and can never satisfy
a demand, because only a declared factor is ever asked for.

## Storage

How a session got here lives in the session, so [`logout()`](../core/lib/auth/login.ts) and the id
rotation clear it without help.

`usr_auth_factor` holds what a factor remembers per user — one row per secret, so several
authenticator apps or a handful of backup codes are rows of the same `type`. `data` is the factor's
own JSON and `auth` never looks inside; `store()`, `stored()` and `drop()` are the whole interface,
all keyed by the user, so no factor module has to check ownership. A factor with real columns of its
own keeps its own table, as [auth.webauthn](../auth.webauthn/) does.

## Open

- **A login through a provider that needs two factors.** The oauth round trip returns as a redirect
  and cannot answer with what is missing; it needs a "finish signing in" page, the same thing
  `finishLogin.mjs` does. Until then it refuses — with `core.loginTwoFactor` on, an oauth user meets
  a bare 403 ([auth.oauth/plugin.ts](../auth.oauth/plugin.ts#L234)).
- **The policy beyond the one switch.** The **known client**: a stolen password sits on an unknown
  one by definition, and `client_usr` knows the difference — it may excuse the second factor at
  login and never satisfy a step-up, with a mail on a login from a new client as the counter-check.
  The **floor for whoever set nothing up**: everybody has a mail address, but mail is also the reset
  path. And **blocking or catching up**: a code by mail every time, or letting them in and pinning
  them to setting a factor up.
- **Properties.** Whether a proof was phishing-resistant becomes a field on `Factor` as soon as a
  policy reads it, and not before.
- **A code as a login factor, and approval instead of a code.** [auth.otp](../auth.otp/) is step-up
  only today. A tap instead of a code is not phishable but invites MFA fatigue — the answer is
  number matching, a mechanism of its own.
- **The backend pages act on their own account** and call the `mod.ts` functions directly, past the
  verbs and their `requireStepUp`. They are form posts and would show a `StepUpError` as an error
  page; the `cms.cont.my.*` pages are the right place anyway.
- **A wait tells you the address exists.** What is counted is the account, so the user must be known
  before there is anything to ask — four wrong tries to learn that, against not telling the owner
  why they cannot get in.
- **Nobody stops you locking yourself out.** The question "is a way in left?" is
  `userFactors(app, usrId)`.
