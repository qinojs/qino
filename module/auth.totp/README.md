# auth.totp

The six digits an authenticator app shows — Google Authenticator, Aegis, 1Password, any of them.
A factor for [auth](../auth/): it runs the ceremony and reports the result, `auth` decides what the
result is worth.

```ts
export const authFactors = [{ name: "totp", label: "Authenticator app", stepUp: true }];
```

## Setting one up

```ts
const { secret, uri } = enrol(ctx);   // shown once: the uri behind a QR, the secret to type
await confirm(ctx, code, "Phone");    // the code is what proves the app really has it
```

The candidate secret waits in the **session** until a code confirms it, not in the table. An
enrolment somebody walks away from therefore leaves nothing behind and needs no sweeping.

`uri` is `otpauth://totp/<host>:<email>?secret=…`, which is what a QR code has to contain.
The backend page renders it with `<u2-qrcode>`, so nothing has to draw a QR on the server.

## Proving

```ts
await verify(ctx, code);   // -> what auth made of the proof
await forget(ctx, id);     // remove one app again
```

Several apps per user are normal — a phone and a tablet — so `verify` tries each stored secret. Both
`verify` and `forget` are keyed by the signed-in user, so neither can reach a foreign row.

## The algorithm

[lib/totp.ts](lib/totp.ts) is RFC 6238 over Web Crypto: HMAC-SHA1, six digits, thirty-second steps,
one step of tolerance either way for clocks that drift. None of that is a choice — it is what every
authenticator app assumes, and changing any of it means the codes stop matching. The tests check
against the RFC's own vectors rather than against the implementation.

No dependency: base32 and the truncation are about sixty lines together.

## Storage

Rows of type `totp` in `usr_auth_factor`, which [auth](../auth/) owns; `data` is `{ secret }`.
A secret is a shared secret by nature — whoever holds the database can generate codes with it. That
is the difference to [auth.webauthn](../auth.webauthn/), where the server keeps only a public key,
and the reason a passkey is the better factor wherever one is available.

## Possible extensions

- **A page for users to set their own up.** Today only the backend page
  [cms.backend.superuser.auth.totp](../cms.backend.superuser.auth.totp/) does it.
- **Refusing a replayed code.** The same code is valid for thirty seconds, so it works twice within
  the window. Remembering the last counter per row would close that.
