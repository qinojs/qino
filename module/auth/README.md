# auth

Collects the ways a user can prove who they are, and decides what a proof is worth.

**A factor proves who you are; the state of the request decides what that means.** Login and
"confirm it's still you" are the same proof, so the module that ran the check only reports the
result:

```ts
await proof(ctx, "webauthn", usrId);
```

If nobody is signed in, this is a login and core creates the session. If the same user is already
signed in, it is a fresh proof stored in the session — a step-up. It resolves with **nothing on
success, otherwise with the factors still missing**; an empty list means nothing helps (inactive
user, or a factor that isn't allowed here).

## Declaring a factor

A module exports `authFactors` from its plugin, like [messaging](../messaging/) collects channels:

```ts
export const authFactors: Factor[] = [{ name: "webauthn", label: "Passkey", stepUp: true }];
```

It is a list because a module may bring several ([auth.otp](../auth.otp/) has one per channel), or a
function of the app if the list is only known at runtime.

- `stepUp` — may also refresh an open session. Federated logins leave it out: the provider answers
  from its own session and says nothing about who is at the keyboard now.
- `second` — only allowed as second factor. [auth.backup_codes](../auth.backup_codes/) only
  finishes a login, so a stolen code is useless without the password.
- `order` — sort order when several are offered; the dialog opens the first. Presentation only.
- `has` — optional. Without it, the factor counts as available for every user.

`factors(app)` lists what linked modules declare, `userFactors(app, usrId)` what one user has set
up. `auth` knows no factor by name, so a new factor needs no code here and shows up in
[cms.backend.superuser.auth](../cms.backend.superuser.auth/) automatically. `core` declares
`password`. Each factor has its own `cms.cont.my.*` page for setup.

## Login with more than one factor

`core.loginTwoFactor` requires a second factor. The first proof then only stores the identity as
`core.pending` in the anonymous session for ten minutes; the session rotation on the real login
removes it. No extra table, nothing to clean up. Users without a second factor get in with one.

In the browser this is the step-up dialog again: while a login is pending, core loads
[`finishLogin.mjs`](../core/pub/js/finishLogin.mjs) on every page, which calls
`GET core/login/missing`. So a login that returns via redirect (oauth) is finished on the page it
lands on. The `verify` verbs use `Access.IDENTIFIED` — **the signed-in user, or the one a pending
login has identified** (`identified(ctx)` in server code). That is why a code is only ever sent to
a user the request already knows.

## Brute-force protection

Failed attempts are counted per account, not per method
([attempts.ts](../core/lib/auth/attempts.ts)): `beforeProof()` runs before every check of something
guessable, `proofFailed()` raises the wait, `proofPassed()` resets it. Three free tries, then a wait
that doubles up to five minutes, forgotten after an hour. A counter per factor would let an
attacker split guesses across password, totp and backup codes.

It is a wait, not a lockout — a lockout could be triggered by anyone who knows an e-mail address.
The counter resets when the login is **finished**, not after each factor; otherwise knowing the
password would reset the budget for guessing the second one.
[auth.webauthn](../auth.webauthn/) is not counted: a signature can't be guessed.

## Requiring a fresh proof

[`requireStepUp(ctx, { maxAge })`](../core/lib/auth/factors.ts) throws `StepUpError`
(`code: "step_up_required"`, plus the factors this user could use). Only factors with `stepUp`
count, so `remember` and `login_as` never satisfy it.

A verb that always needs it declares it; [`invoke()`](../core/lib/api/invoke.ts#L98) checks it after
the access checks and before `execute`:

```ts
requireStepUp: true,             // always
requireStepUp: { maxAge: 60 },   // always, with a shorter max age
```

If it depends on the call, use `guard`. It sees path params and validated input and runs before
anything happens — important, because the browser repeats the same request after the dialog:

```ts
guard: ({ amount }, ctx) => amount <= 1000 || requireStepUp(ctx, { maxAge: 60 }),
```

The field is still needed: tools listing verbs can only see the field. [`mcp`](../mcp/) uses it to
hide those verbs, since an agent cannot answer a dialog. Every verb that adds or removes a factor
has it, because it changes what counts as proof from then on.

A route is not a verb and cannot require a step-up (a `StepUpError` would show as a 403 page). So
the connect button first calls `POST auth.oauth/connect`, and `oauth/start/<name>` uses that result.

Users without any factor pass — otherwise they could never set up their first one. The dry run
(`x-api-check: access`) only checks who *may* call a verb and requires nothing.

In the browser, [`ApiClient`](../core/pub/js/ApiClient.js) offers `recover(error)`: a hook that may
fix a failed request and send it **once** more. The dialog knows no factor by name — each factor
has a `pub/stepup.js` exporting `prove(root)`, and the error says which module to load it from.

## What a proof is not

**Not a permission.** `access` and `guard` decide whether a user may do something; a proof only
says the person is present right now.

**Not account recovery.** A link is a [ticket](../ticket/), a one-time code is a normal factor.

**Not an API key.** An [auth.api_keys](../auth.api_keys/) key identifies the user of a request but
never opens a session. It is no factor and satisfies no step-up — there is nobody to ask.

**Also a log.** The session stores `core.via.<name> = <when>` for every way in, including ones that
prove nothing (`remember`, `login_as`). They are visible for auditing but never satisfy a step-up,
since only declared factors are checked.

## Storage

How a session was established is stored in the session, so
[`logout()`](../core/lib/auth/login.ts) and the id rotation clear it automatically.

`usr_auth_factor` holds per-user factor data — one row per secret, so several authenticator apps or
backup codes are rows with the same `type`. `data` is the factor's own JSON; `auth` never reads it.
The interface is `store()`, `stored()` and `drop()`, all keyed by user, so factor modules don't
need to check ownership. A factor that needs real columns has its own table, like
[auth.webauthn](../auth.webauthn/).

## Open

- **More policy.** *Known client*: a stolen password is used on an unknown client, and
  `client_usr` can tell — it could skip the second factor at login (never for step-up), with a mail
  on login from a new client. *Minimum for users without a factor*: everyone has mail, but mail is
  also the reset path. *Block or nudge*: require a mail code every time, or let them in and push
  them to set up a factor.
- **Properties.** "Phishing-resistant" becomes a field on `Factor` once a policy needs it.
- **Code as login factor, and approval instead of a code.** [auth.otp](../auth.otp/) is step-up
  only today. Tapping "approve" can't be phished but invites MFA fatigue — the fix is number
  matching.
- **Backend pages act on the own account** and call `mod.ts` directly, bypassing the verbs and
  their `requireStepUp`. They are form posts and would show a `StepUpError` as an error page; the
  `cms.cont.my.*` pages are the right place anyway.
- **A wait reveals that the address exists.** Counting per account requires a known user — four
  wrong tries reveal that, but the owner learns why they can't get in.
- **Nothing prevents locking yourself out.** Check with `userFactors(app, usrId)`.
