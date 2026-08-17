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

## Declaring a factor

A module says it can prove an identity by exporting `authFactors` from its plugin, the same way
[messaging](../messaging/) collects channels:

```ts
export const authFactors: Factor[] = [{ name: "webauthn", label: "Passkey", login: true, stepUp: true }];
```

A list, because one module may bring several: [auth.otp](../auth.otp/) has one factor per messaging
channel. When which ones exist is only known at runtime, the export is a function of the app
instead — that is the whole reason it takes one.

`order` decides where a factor sits when several are offered, lowest first, so the dialog can open
the best one right away — a passkey before a typed code, backup codes last. It is presentation, not
a verdict: what a factor is worth is not a number, and a policy that needs to know will read a
property, not a rank.

`login` and `stepUp` are separate on purpose: starting a session and refreshing one are different
permissions, and a factor may have either. A federated login declares only `login` — the provider
answers from its own session and says nothing about who is at the keyboard now.

`factors(app)` lists what linked modules declare, `userFactors(app, usrId, "stepUp")` narrows it to
what would actually work for one person. Nothing here knows a factor by name, so a new one costs no
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

`has` is optional: a factor that cannot answer it per user — as a federated login cannot, since which
user a provider returns is only known once they have come back — is still offered as a way in, but
never counted as something the user *has*.

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

[`requireStepUp(ctx, { maxAge })`](../core/lib/auth.ts#L88) lives in core, where `via` is written.
It counts only what a linked module declares with `stepUp`, so `remember` and `login_as` never
satisfy one, and it throws `StepUpError` — `code: "step_up_required"`, and the factors that would
work for this user.

Where the demand belongs is settled by [`invoke()`](../core/lib/api/invoke.ts#L93): both get the
same `params`, but the guard runs before the validated input is merged into it, so at that moment
it holds the resolved path params and nothing else. An endpoint that
always needs a proof can say so there, but one that needs it for some values and not others —
a transfer above a limit, a bulk delete past a count — cannot, and has to ask inside `execute`
before it does anything. So the demand is a **function that throws**, not a flag on the verb:

```ts
guard: (_p, ctx) => requireStepUp(ctx, { maxAge: 300 }),          // always
execute: async ({ amount }, ctx) => {
  if (amount > 1000) await requireStepUp(ctx, { maxAge: 60 });    // only sometimes
```

A verb property (`stepUpNeeded: true`) would cover only the first case and add surface for what
`guard` can already express. Throwing needs no machinery: `invoke` does not catch, and
[`apiFetch`](../core/lib/api/fetch.ts#L44) turns any `ApiError` into the response. Resolving with
`true` keeps the guard form a one-liner. What the `execute` form owes is the whole point of it —
it has to throw before the first side effect, and only the author can guarantee that.

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
- **More than one factor for a login.** The partial state belongs in the session, which the id
  rotation already empties — no second place to expire and sweep.
- **A code as a login factor, and approval instead of a code.**
  [auth.otp](../auth.otp/) carries one to any channel today, but only for step-up: a code can be
  requested only for a user the request already knows. Telegram and Web Push could ask for a tap
  rather than a code, which is not phishable but invites MFA fatigue — the answer to that is number
  matching, and it is a mechanism of its own.
