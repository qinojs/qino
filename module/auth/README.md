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

A module says it can prove an identity by exporting `authFactor` from its plugin, the same way
[messaging](../messaging/) collects channels:

```ts
export const authFactor: Factor = { name: "webauthn", label: "Passkey", login: true, stepUp: true };
```

`login` and `stepUp` are separate on purpose: starting a session and refreshing one are different
permissions, and a factor may have either. A federated login declares only `login` — the provider
answers from its own session and says nothing about who is at the keyboard now.

`factors(app)` lists what linked modules declare. Nothing here knows a factor by name, so a new one
costs no code in `auth`.

## What a proof is not

**Not a permission.** `access` and `guard` decide whether a user may do something at all. A proof
only says the person is there right now — it protects an allowed but grave action against an
unattended session, and can never grant what the user was not entitled to.

**Not a record of proofs only.** The session keeps `core.via.<name> = <when>` for every way in, and
core writes entries there that prove nothing: `remember` for a login the stored client was handed,
`login_as` for one an administrator took over. They are auditable and can never satisfy anything,
because only a factor a linked module declares is ever asked for.

There is no table: the record lives in the session, so [`logout()`](../core/lib/auth.ts) and the id
rotation on every login clear it without help.

## Possible extensions

- **A step-up guard** for api verbs (`guard: stepUp({ maxAge: 300 })`) answering with a stable
  `step_up_required`. The api error already carries a `code` and `data`; the policy and the client
  dialog are missing. A policy also wants to ask for properties — that a passkey is unphishable and
  a typed code is not — which is a field on `Factor` as soon as something reads it.
- **Listing what one user has**, for a "your sign-in methods" page. Needs a `has()` per factor, and
  an honest answer for the ones that cannot know: which user a provider returns is only known once
  they have come back.
- **More than one factor for a login.** The partial state belongs in the session, which the id
  rotation already empties — no second place to expire and sweep.
- **Factors of their own**: TOTP, backup codes, and a code to a verified contact once
  [mail](../mail/) can say which addresses are verified.
