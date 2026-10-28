import { Access, contacts, getCtx, removeContact, s, setMainContact } from "@qino/qino";
import { pendingContacts } from "@qino/qino/messaging";

import { close } from "./lib/transport.ts";
import { addEmail, receive, verifyEmail } from "./mod.ts";

import type { ApiTree, App, Params } from "@qino/qino";
import type { Jobs } from "@qino/qino/cron";

export { messagingChannel } from "./mod.ts";
export { default as dbSchema } from "./dbschema.json" with { type: "json" };

export { settingsSchema } from "./lib/settings.ts";
export { healthChecks } from "./healthChecks.ts";

// Mail arrives by being fetched, so the channel is only as live as this interval.
export const cron = {
  inbox: {
    every: 300,
    timeout: 120,
    run: (app: App) => receive(app),
  },
} satisfies Jobs;

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  signal.addEventListener("abort", () => close(app), { once: true });
}

export const api: ApiTree = {

  emails: {
    get: {
      description: "The signed-in user's verified email addresses and the ones still being verified",
      access: Access.USER,
      execute: async () => {
        const ctx = getCtx();
        const [emails, pending] = await Promise.all([
          contacts(ctx.app.db, ctx.userId, "email"),
          pendingContacts(ctx.app, "email", ctx.userId),
        ]);
        return { emails, pending };
      },
    },
    post: {
      description: "Claim an email address and send a verification code",
      access: Access.USER,
      input: s.object({ address: s.string() }),
      execute: ({ address }: Params) => {
        const ctx = getCtx();
        return addEmail(ctx.app, ctx.userId, String(address));
      },
    },
    verify: {
      post: {
        description: "Confirm a claimed address with its six-digit code",
        access: Access.USER,
        input: s.object({ address: s.string(), code: s.string() }),
        execute: ({ address, code }: Params) => {
          const ctx = getCtx();
          return verifyEmail(ctx.app, ctx.userId, String(address), String(code));
        },
      },
    },
  },

  // the address is the identity before and after verification (no row id)
  email: {
    ":address": {
      paramSchema: s.string(),
      delete: {
        description: "Delete one of the signed-in user's email addresses",
        access: Access.USER,
        execute: async ({ address }: Params) => {
          const ctx = getCtx();
          await removeContact(ctx.app.db, ctx.userId, "email", String(address));
          return { ok: true };
        },
      },
      main: {
        put: {
          description: "Make this the signed-in user's preferred email address",
          access: Access.USER,
          execute: ({ address }: Params) => {
            const ctx = getCtx();
            return setMainContact(ctx.app.db, ctx.userId, "email", String(address));
          },
        },
      },
    },
  },

};
