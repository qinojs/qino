# auth.backup_codes

Ten codes on a piece of paper, for the day the phone with the authenticator app is gone. A factor
for [auth](../auth/), and deliberately a narrow one.

```ts
const codes = await generate(ctx);   // shown this once, never again
await spend(ctx, code);              // gone the moment it works
```

## Never a way in on its own

```ts
export const authFactor = { name: "backup_codes", label: "Backup codes", stepUp: true };
```

No `login`. A backup code stands in for the **second** factor, the way the list next to an e-banking
login does — the password is asked first and the code alone is worth nothing. Declaring `login`
would make it a one-time password for the whole account, because [`proof()`](../auth/) turns a proof
into a session whenever nobody is signed in yet. It becomes a login factor the day a login can ask
for two of them, not before.

## Why the codes look the way they do

Twelve characters, `XXXX-XXXX-XXXX`, out of a 32-character alphabet — Crockford base32, which has no
I, L, O or U to misread, and whose size means a random byte masked to five bits picks one without
bias. That is 60 bits.

Kept as **bcrypt**, not as a fast digest, and that is what makes the length enough. A stolen database
is the one attack no rate limit answers: nobody is waiting for a login form, the hashes are simply
ground offline. A fast hash falls to 60 bits in months; bcrypt costs milliseconds a guess instead of
nanoseconds and turns the same 60 bits into far longer than anyone will wait. A *keyed* hash would
not have helped — settings live in the database too, so the key would be stolen along with them.

The price is honest: `spend()` tries the remaining rows one at a time, up to about a second. That is
a rare action on one's own account.

## Storage

Rows of type `backup_codes` in `usr_auth_factor`, which [auth](../auth/) owns; `data` is `{ hash }`.
One row per code, so spending one is a `DELETE` and the count of rows is the count that is left —
there is no "used" flag anyone could forget to check. The delete also decides the race: of two
requests with the same code only one removes a row, and only that one gets a proof.

`generate()` replaces the whole set, so a user who has lost track of their sheet simply makes a new
one.

## Possible extensions

- **A page for users to generate their own.** Today only the backend page
  [cms.backend.superuser.auth.backup_codes](../cms.backend.superuser.auth.backup_codes/) does it.
- **Telling them when the sheet runs low.** The count is there; nothing acts on it.
