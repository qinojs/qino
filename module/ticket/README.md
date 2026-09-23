# ticket

**Whoever has the handle may do the thing, once.** No session, no account. Like a password-reset
link or an invitation.

```ts
// the module says what its ticket entitles you to
export const tickets: Record<string, TicketKind> = {
  "auth.resetPw": {
    ttl: 3600,
    redeem: (app, t, input: { pw: string }) => setPassword(app, t.data.usrId, input.pw),
  },
};

// issue one and hand out the handle — the only moment it exists in the clear
const handle = await issue(app, "auth.resetPw", { usrId: usr.id });

// the page behind the link looks, without spending anything
if (!await check(app, handle)) return t`This link is no longer valid.`;

// the form redeems it
await redeem(app, handle, "auth.resetPw", { pw });
```

Three functions: `issue`, `check`, `redeem`. The handle finds its own row. The kind argument of
`redeem` is optional; passing it makes sure a handle of another kind is rejected. There is no read
API — the backend page is the only reader and uses its own queries.

## Never redeem from a GET

Mail scanners, link checkers and Outlook SafeLinks open every URL. A link that acts when opened
is used up before its owner clicks it (the old PHP `hashAction` allowed a hundred uses for that
reason). So the link shows a page, and the page redeems. That's what `check()` is for.

## What it is not

**Not for typed codes.** Six digits can be guessed, so they need "who asks" and "how often" —
another mechanism, see [messaging](../messaging/#verifying-a-contact). What matters is the secret,
not the channel: verifying a mail address *by link* is a ticket, *by code* it is not.

**Not an access grant.** A share link opened by many people repeatedly is checked, not redeemed.
`uses` is for a few redemptions, not for permissions.

## Storage

`ticket` — the handle is 32 random bytes, stored as `hash`, so a leaked database contains no
working handles. Plain SHA-256 without key: at that entropy nothing can be guessed. `data` is the
payload from `issue`; `expires` is only null if the kind allows it.

Used-up tickets are not deleted. `uses` is how often it may be redeemed, `used` how often it was;
`used >= uses` or a past `expires` means invalid. The row stays, so the backend can show what was
issued and what happened. A daily cron removes them a year after issue, but only if invalid: an
unused link without expiry is kept.

Consumers: [cms.cont.pwReset](../cms.cont.pwReset/) issues them,
[cms.backend.superuser.tickets](../cms.backend.superuser.tickets/) watches them.

## Possible extensions

- **One route for all links**, dispatching by kind, so a module needs no own page for a simple
  confirmation.
- **Rate limit per issuer**, so "send me the reset mail" can't be used to flood someone.
- **Invitations** — fit this shape, not built yet.
