import { Access, countContacts, getCtx, s } from "@qino/qino";

import { addPhone, send, verifyPhone } from "./mod.ts";

import type { ApiTree, App, Params } from "@qino/qino";
import type { Channel } from "@qino/qino/messaging";

export const messagingChannel: Channel = {
  name: "sms",
  label: "SMS",
  color: "--green",
  contact: "phone",
  reach: (app: App, usrId: number) => countContacts(app.db, usrId, "phone"),
  send,
};

export const settingsSchema = {
  properties: {
    provider: {
      properties: {
        type: { type: "string", enum: ["", "twilio", "http"], description: "Built-in provider; applications may also inject one with setProvider()" },
        twilio: {
          properties: {
            accountSid: { type: "string" },
            apiKeySid: { type: "string", description: "Recommended API key SID" },
            apiKeySecret: { type: "string" },
            authToken: { type: "string", description: "Account Auth Token fallback" },
            from: { type: "string", description: "Sender number; omit when using a Messaging Service" },
            messagingServiceSid: { type: "string" },
          },
        },
        http: {
          properties: {
            url: { type: "string", description: "Receives POST JSON with to, text and from" },
            token: { type: "string", description: "Optional Bearer token" },
            from: { type: "string" },
          },
        },
      },
    },
  },
};

export const api: ApiTree = {

  phones: {
    get: {
      description: "The signed-in user's verified numbers and the ones still being verified",
      access: Access.USER,
      execute: async () => {
        const ctx = getCtx();
        const [phones, pending] = await Promise.all([
          contacts(ctx.app.db, ctx.userId, "phone"),
          pendingContacts(ctx.app, "phone", ctx.userId),
        ]);
        return { phones, pending };
      },
    },
    post: {
      description: "Claim an international phone number and send a verification code",
      access: Access.USER,
      input: s.object({ number: s.string() }),
      execute: ({ number }: Params) => {
        const ctx = getCtx();
        return addPhone(ctx.app, ctx.userId, String(number));
      },
    },
    verify: {
      post: {
        description: "Confirm a claimed number with its six-digit SMS code",
        access: Access.USER,
        input: s.object({ number: s.string(), code: s.string() }),
        execute: ({ number, code }: Params) => {
          const ctx = getCtx();
          return verifyPhone(ctx.app, ctx.userId, String(number), String(code));
        },
      },
    },
  },

  // the number is the address and the identity, before and after verification — no row id in between
  phone: {
    ":number": {
      paramSchema: s.string(),
      delete: {
        description: "Delete one of the signed-in user's phone numbers",
        access: Access.USER,
        execute: async ({ number }: Params) => {
          const ctx = getCtx();
          await removeContact(ctx.app.db, ctx.userId, "phone", String(number));
          return { ok: true };
        },
      },
      main: {
        put: {
          description: "Make this phone the signed-in user's preferred SMS number",
          access: Access.USER,
          execute: ({ number }: Params) => {
            const ctx = getCtx();
            return setMainContact(ctx.app.db, ctx.userId, "phone", String(number));
          },
        },
      },
    },
  },

};
