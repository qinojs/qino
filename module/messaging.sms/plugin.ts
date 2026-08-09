import dbSchema from "./dbschema.json" with { type: "json" };
import { Access, getCtx, s, type ApiTree, type App, type Params } from "../core/mod.ts";
import type { Channel } from "../messaging/mod.ts";
import { addPhone, removePhone, send, setMainPhone, userPhones, verifyPhone } from "./mod.ts";

export const name = "messaging.sms";
export const description = "SMS — verifies user phone numbers and delivers messages through a configurable provider.";
export const needs = ["messaging"];
export { dbSchema };

export const messagingChannel: Channel = {
  name: "sms",
  label: "SMS",
  color: "--green",
  reach: async (app: App, usrId: number) =>
    Number(await app.db.one`SELECT COUNT(*) FROM usr_phone WHERE usr_id = ${usrId} AND verified IS NOT NULL`),
  send: (app: App, usrId: number, text: string) => send(app, { usr: usrId }, text),
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
    _secret: { type: "string", description: "Secret for verification hashes — generated on first use" },
  },
};

export const api: ApiTree = {

  phones: {
    get: {
      description: "List the signed-in user's phone numbers and verification state",
      access: Access.USER,
      execute: () => {
        const ctx = getCtx();
        return userPhones(ctx.app, ctx.userId);
      },
    },
    post: {
      description: "Add an international phone number and send a verification code",
      access: Access.USER,
      input: s.object({ number: s.string() }),
      execute: ({ number }: Params) => {
        const ctx = getCtx();
        return addPhone(ctx.app, ctx.userId, String(number));
      },
    },
  },

  phone: {
    ":id": {
      paramSchema: s.number(),
      delete: {
        description: "Delete one of the signed-in user's phone numbers",
        access: Access.USER,
        execute: async ({ id }: Params) => {
          const ctx = getCtx();
          await removePhone(ctx.app, ctx.userId, Number(id));
          return { ok: true };
        },
      },
      verify: {
        post: {
          description: "Confirm a phone number with its six-digit SMS code",
          access: Access.USER,
          input: s.object({ code: s.string() }),
          execute: ({ id, code }: Params) => {
            const ctx = getCtx();
            return verifyPhone(ctx.app, ctx.userId, Number(id), String(code));
          },
        },
      },
      main: {
        put: {
          description: "Make this verified phone the signed-in user's preferred SMS number",
          access: Access.USER,
          execute: ({ id }: Params) => {
            const ctx = getCtx();
            return setMainPhone(ctx.app, ctx.userId, Number(id));
          },
        },
      },
    },
  },

};
