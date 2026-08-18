# auth

One idea: **a factor proves who you are, and where the request stands decides what that is worth.**
Signing in and confirming you are still there are not two mechanisms — they are the same proof in
two situations.

```ts
// the module that ran the ceremony says only what it found out
await proof(ctx, "webauthn", usrId);
```

Not signed in, that is a login and core turns the identity into a session. Already signed in as
that user, it is a fresh proof recorded in the session — a step-up. The caller writes the same
line either way and never has to ask which case it is in.

It resolves with **nothing when that went through, otherwise with what is still missing** — a login
waiting for a second factor lists what would finish it, and an empty list means nothing here will
help: an inactive user, or a factor that may not do this at all.

## Declaring a factor

A module says it can prove an identity by exporting `authFactors` from its plugin, the same way
[messaging](../messaging/) collects channels:

```ts
export const authFactors: Factor[] = [{ name: "webauthn", label: "Passkey", stepUp: true }];
```

A list, because one module may bring several: [auth.otp](../auth.otp/) has one factor per messaging
channel. When which ones exist is only known at runtime, the export is a function of the app
instead — that is the whole reason it takes one.

`order` decides where a factor sits when several are offered, lowest first, so the dialog can open
the best one right away — a passkey before a typed code, backup codes last. It is presentation, not
a verdict: what a factor is worth is not a number, and a policy that needs to know will read a
property, not a rank.

Every factor can take part in a login; the two flags say what it may do beyond that. `stepUp` also
refreshes a session that is already open — a federated login leaves it out, because the provider
answers from its own session and says nothing about who is at the keyboard now. `second` can only
ever be the second factor: [auth.backup_codes](../auth.backup_codes/) finishes a login somebody
else started and never begins one, so a stolen code is worth nothing without the password in front
of it.

`factors(app)` lists what linked modules declare, `userFactors(app, usrId)` narrows it to what one
person actually has. Nothing here knows a factor by name, so a new one costs no
code in `auth` and appears in
[cms.backend.superuser.auth](../cms.backend.superuser.auth/) on its own. `core` is one of those
modules and declares `password` itself — the column, the check and the form are not optional, only
the declaration was missing.

Setting a factor up is the user's own business, so each has a `cms.cont.my.*` page of its own —
[my.totp](../cms.cont.my.totp/), [my.webauthn](../cms.cont.my.webauthn/),
[my.backup_codes](../cms.cont.my.backup_codes/), [my.oauth](../cms.cont.my.oauth/) — except the
[auth.otp](../auth.otp/) factors, which have nothing to set up: the channel is the enrolment.
Several on one
page make the security overview, so no module has to ask at runtime what is installed.

`has` is optional: a factor that cannot answer it per user — as a federated login cannot, since
which user a provider returns is only known once they are back — leaves it out and counts as
available for everyone.

## A login of more than one factor

`core.loginTwoFactor` asks for a second one. The first proof then opens nothing: the identity waits
in the anonymous session as `core.pending` for ten minutes, and the session rotation on the real
login clears it — there is no half-login table and nothing to sweep. Whoever has no second factor is
let in with one, for the same reason a step-up gives way for someone with no factor at all.

The browser side is the step-up dialog again. The login page loads
[`finishLogin.mjs`](../core/pub/js/finishLogin.mjs), which asks `GET core/login/missing` and opens
it; each factor's `pub/stepup.js` is unchanged, because the verbs behind them ask for
`Access.IDENTIFIED` — **whoever is signed in, or whoever a login under way has established.**
`identified(ctx)` is the same question in server code, and it is why a code can be sent at all: it
can only ever go to a user the request already knows.

## What a proof is not

**Not a permission.** `access` and `guard` decide whether a user may do something at all. A proof
only says the person is there right now — it protects an allowed but grave action against an
unattended session, and can never grant what the user was not entitled to.

**Not a record of proofs only.** The session keeps `core.via.<name> = <when>` for every way in, and
core writes entries there that prove nothing: `remember` for a login the stored client was handed,
`login_as` for one an administrator took over. They are auditable and can never satisfy anything,
because only a factor a linked module declares is ever asked for.

## Storage

The record of how a session got here lives in the session, so [`logout()`](../core/lib/auth.ts) and
the id rotation on every login clear it without help.

`usr_auth_factor` holds what a factor has to remember per user — one row per secret, so several
authenticator apps, or a handful of backup codes, are rows of the same `type` rather than a list
inside one. `data` is the factor's own JSON and `auth` never looks inside it; `store()`, `stored()`
and `drop()` are the whole interface. `drop()` is always keyed by the user, so a factor module never
has to check ownership itself and a foreign id removes nothing.

A factor with real columns of its own keeps its own table, as [auth.webauthn](../auth.webauthn/) does.

## Demanding a fresh proof

[`requireStepUp(ctx, { maxAge })`](../core/lib/factors.ts) lives in core, next to what it reads.
It counts only what a linked module declares with `stepUp`, so `remember` and `login_as` never
satisfy one, and it throws `StepUpError` — `code: "step_up_required"`, and the factors that would
work for this user.

A verb that always needs one says so, and [`invoke()`](../core/lib/api/invoke.ts#L95) asks on its
behalf — after the access gate, before anything is validated or run:

```ts
requireStepUp: true,                                              // always
requireStepUp: { maxAge: 60 },                                    // always, and sooner
```

Where it depends on the call, the demand stays a function that throws. In a `guard` for what the
path says, and inside `execute` for what only the input knows — a transfer above a limit, a bulk
delete past a count — because the guard runs before the validated input is merged into `params`
(ISSUES 277):

```ts
guard: (p, ctx) => p.node.owner === ctx.userId || requireStepUp(ctx),
execute: async ({ amount }, ctx) => {
  if (amount > 1000) await requireStepUp(ctx, { maxAge: 60 });     // before the first side effect
```

The field is not shorthand for the guard form: it is the only one a listing can see. A stateless
caller can never answer a demand — a Bearer token identifies a request, not a session — so
[`mcp`](../mcp/) leaves those verbs out of its tool list instead of offering a call that is certain
to fail. And a declared demand cannot be made too late, which is exactly what the `execute` form
owes and only its author can guarantee.

Throwing needs no machinery either way: `invoke` does not catch, and
[`apiFetch`](../core/lib/api/fetch.ts#L44) turns any `ApiError` into the response. A dry run
(`x-api-check: access`) deliberately does not demand a proof: it asks who may use a verb, and the
proof is something the caller can still give.

Whoever has no factor at all passes. A demand nobody can meet protects nothing — it would only lock
someone out of setting up their first factor — so it holds for a stateless request, where there is
no session to prove into, and gives way for everyone else.

In the browser, [`ApiClient`](../core/pub/js/ApiClient.js) knows nothing of any of this: it offers
`recover(error)`, a hook that may fix a failed request and have it sent **once** more. `qino.js`
sets it to the one thing worth retrying, and only that line names the step-up. The dialog knows no
factor by name: each one ships a `pub/stepup.js` exporting `prove(root, factor)`, and the error says which
module to import it from. A factor that renders a field fills `root` and resolves `true` when the
proof went through; a passkey needs no field and starts the authenticator instead.

```js
// auth.totp/pub/stepup.js — `proveForm` comes from the dialog, since the shape is its contract
export async function prove(root) {
  const { done } = await proveForm(root, field, (form) => check(form.elements.code.value));
  return done;
}
```

Nothing on the client is registered anywhere, so a new factor is again one module and no edit here.

## Possible extensions

- **Properties in the policy.** A policy will want to ask whether a proof was phishing-resistant —
  a field on `Factor` as soon as something reads it, and a claim nobody checks before that.
- **A login through a provider that needs two.** Every other way in is a verb whose answer the page
  can read; the oauth round trip comes back as a redirect and needs a page of its own to ask for
  what is missing. Until then it refuses rather than opening a login half way.
- **A code as a login factor, and approval instead of a code.**
  [auth.otp](../auth.otp/) carries one to any channel today, but only for step-up: a code can be
  requested only for a user the request already knows. Telegram and Web Push could ask for a tap
  rather than a code, which is not phishable but invites MFA fatigue — the answer to that is number
  matching, and it is a mechanism of its own.
