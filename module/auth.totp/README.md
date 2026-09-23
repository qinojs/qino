# auth.totp

The six digits of an authenticator app — Google Authenticator, Aegis, 1Password, any of them.
A factor for [auth](../auth/): it checks the code, `auth` decides what that is worth.

```ts
export const authFactors = [{ name: "totp", label: "Authenticator app", stepUp: true }];
```

## Setting one up

```ts
const { secret, uri } = enrol(ctx);   // shown once: the uri behind a QR, the secret to type
await confirm(ctx, code, "Phone");    // the code is what proves the app really has it
```

The new secret waits in the **session** until a code confirms it, not in the table. An
abandoned setup leaves nothing behind.

`uri` is `otpauth://totp/<host>:<email>?secret=…`, the QR code content. The pages render it with
`<u2-qrcode>`, so the server draws no QR.

## Proving

```ts
await verify(ctx, code);   // -> what auth made of the proof
await forget(ctx, id);     // remove one app again
```

A user may have several apps (phone and tablet), so `verify` tries each stored secret. Both
`verify` and `forget` only touch rows of the signed-in user.

## The algorithm

[lib/totp.ts](lib/totp.ts) is RFC 6238 with Web Crypto: HMAC-SHA1, six digits, 30-second steps,
one step tolerance each way for clock drift. Every authenticator app expects exactly this. The
tests use the RFC's test vectors.

No dependency: base32 and truncation are about sixty lines.

## Storage

Rows of type `totp` in `usr_auth_factor` (owned by [auth](../auth/)); `data` is `{ secret }`.
Whoever has the database can generate codes. [auth.webauthn](../auth.webauthn/) stores only a
public key — so passkeys are the better factor where available.

Users set it up on [cms.cont.my.totp](../cms.cont.my.totp/), superusers in
[cms.backend.superuser.auth.totp](../cms.backend.superuser.auth.totp/).

## Possible extensions

- **Reject a reused code.** The same code is valid for thirty seconds, so it works twice within
  the window. Remembering the last counter per row would close that.
