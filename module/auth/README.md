# auth

Minimal prototype for user approval of sensitive API/MCP actions. Login orchestration, session
step-up proofs, factor discovery and account recovery remain deliberately unimplemented.

## MCP/API approval flow

An MCP client authenticated as a user calls a sensitive endpoint. Its first `requireApproval()`
call stores an intent hash and notifies the first reachable configured messaging channel. Web Push
is preferred by default; its notification opens the standalone approval page.

Only an interactive cookie session of the same user may approve or deny. A stateless API key can
create and poll its request, but cannot decide it. The caller polls `GET /api/auth/approval/:id` and
then retries its original action.

A sensitive endpoint can make the retry one-time and intent-bound:

```ts
import { getCtx, s } from "@qino/qino";
import { requireApproval } from "../auth/mod.ts";

input: s.object({
  store: s.string(),
  authApproval: s.optional(s.string()),
}),
execute: async ({ store, authApproval }) => {
  const ctx = getCtx();
  await requireApproval(ctx, authApproval, {
    action: "store.add",
    summary: `Add store ${store}`,
    details: { store },
    requester: "MCP chatbot",
  });
  // perform the action only here
}
```

The first call throws an `ApprovalRequired` error containing the approval id and browser URL. After
the user approves, the caller retries with `authApproval`. A changed `store` value produces another
intent and cannot consume the approval.

## Settings

- `auth.approval.ttl`: validity in seconds, 60–3600, default 600.
- `auth.approval.pendingLimit`: pending requests per user, default 10.
- `auth.approval.channels`: notification preference, default `web_push,email,sms`.

The module keeps approval records for 90 days and sweeps them on reads and writes. The companion
`cms.backend.superuser.auth` module shows configuration and recent approvals.
