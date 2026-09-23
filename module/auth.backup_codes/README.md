# auth.backup_codes

Ten codes on paper, for when the phone with the authenticator app is gone. A factor for
[auth](../auth/).

```ts
const codes = await generate(ctx);   // shown this once, never again
await spend(ctx, code);              // gone the moment it works
```

## Never a way in on its own

```ts
export const authFactors = [{ name: "backup_codes", label: "Backup codes", second: true, stepUp: true, order: 90 }];
```

`second`: a backup code only replaces the **second** factor, like the code list of e-banking — the
password comes first, the code alone is worthless. Otherwise it would be a one-time password for
the whole account. `order: 90` puts it last in the dialog.

## Why the codes look the way they do

Twelve characters, `XXXX-XXXX-XXXX`, in Crockford base32: no I, L, O or U to misread, and 32
characters, so five bits of a random byte pick one without bias. That is 60 bits.

Stored as **bcrypt**, not a fast hash — that is why 60 bits are enough. Against a stolen database
no rate limit helps; the hashes are cracked offline. A fast hash falls in months; bcrypt takes
milliseconds per guess instead of nanoseconds. A *keyed* hash would not help: the key lives in the
settings, i.e. in the same database.

The cost: `spend()` checks the remaining rows one by one, up to about a second. Acceptable for a
rare action.

## Storage

Rows of type `backup_codes` in `usr_auth_factor` (owned by [auth](../auth/)); `data` is `{ hash }`.
One row per code: spending is a `DELETE`, the row count is what's left, and there is no "used"
flag to forget. The delete also settles races: of two requests with the same code only one
deletes a row and gets the proof.

`generate()` replaces the whole set, so a user who lost the sheet just makes a new one — on
[cms.cont.my.backup_codes](../cms.cont.my.backup_codes/) or in the backend.

## Possible extensions

- **Warn when few codes are left.** The count exists; nothing uses it yet.
