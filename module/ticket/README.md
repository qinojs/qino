# ticket

One idea: **whoever knows the handle may do the thing, once.** No session, no account, no
second question. That is what a password-reset link, an invitation and an unsubscribe link
all are.

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
if (!await check(app, handle, "auth.resetPw")) return t`This link is no longer valid.`;

// the form redeems it
await redeem(app, handle, { purpose: "auth.resetPw", input: { pw } });
```

Three functions, and the caller never says where to look: the handle finds its own row.

## Never redeem from a GET

Mail scanners, link checkers and Outlook SafeLinks open every URL they are sent. A link that
acts on being opened is burnt before its owner clicks it — that is why the old PHP
`hashAction` had to allow a hundred uses per link. Here the link shows a page and the page
redeems. `check()` exists for exactly that half.

## What it is not

**Not for typed codes.** Six digits are short enough to guess, so they need "who is asking"
and "how often have they tried" — a different mechanism with different columns. Contact
verification lives in [messaging](../messaging/#verifying-a-contact) for that reason. The
dividing line is the shape of the secret, not the channel: verifying a mail address *by link*
is a ticket, the same address *by code* is not.

**Not an access grant.** A share link that many people may open repeatedly is checked, not
redeemed. `uses` is there for a handful of redemptions, not for a permission.

## Storage

`ticket` — `hash` is the identity: the handle is 32 random bytes and is stored keyed-hashed,
so a leaked database hands out no working capabilities. `data` is the payload written when the
ticket is issued; `expires` is null only where the kind says so, and those are never swept.
Expired rows go on the next `issue()`, so there is no cron job.

Consumers: [cms.cont.pwReset](../cms.cont.pwReset/) issues them,
[cms.backend.superuser.tickets](../cms.backend.superuser.tickets/) watches them.

## Possible extensions

- **One route for every link**, dispatching by purpose, so a module does not need its own page
  for a confirmation that has nothing to show.
- **Rate limiting per issuer**, so "send me the reset mail" cannot be used to flood someone.
- **Invitations and unsubscribe links** — both are this shape, neither exists yet.
