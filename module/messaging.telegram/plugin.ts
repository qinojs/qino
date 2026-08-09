import dbSchema from "./dbschema.json" with { type: "json" };
import { Access, getCtx, type ApiTree, type App } from "../core/mod.ts";
import type { Channel } from "../messaging/mod.ts";
import { webhook } from "./lib/webhook.ts";
import { linkUrl, send, userChats } from "./mod.ts";

export const name = "messaging.telegram";
export const description = "Telegram — links accounts to a bot chat and delivers messages to them.";
export const needs = ["messaging"];
export { dbSchema };

export const messagingChannel: Channel = {
  name: "telegram",
  label: "Telegram",
  color: "--blue",
  reach: async (app: App, usrId: number) =>
    Number(await app.db.one`SELECT COUNT(*) FROM telegram_chat WHERE usr_id = ${usrId}`),
  send,
};

export const settingsSchema = {
  properties: {
    botToken: { type: "string", description: "Bot token from @BotFather — without it the module cannot send or receive" },
    webhookSecret: { type: "string", description: "Secret Telegram echoes back on every update — generated on first use" },
  },
};

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  app.on("route", async ({ ctx }) => {
    if (ctx.req.appPath !== "telegram/webhook") return;
    await webhook(ctx);
  }, { signal });
}

export const api: ApiTree = {

  link: {
    get: {
      description: "Deep link that connects the signed-in user's Telegram, plus the chats already linked",
      access: Access.USER,
      execute: async () => {
        const ctx = getCtx();
        const [url, chats] = await Promise.all([linkUrl(ctx.app, ctx.userId), userChats(ctx.app, ctx.userId)]);
        return { url, chats };
      },
    },

    delete: {
      description: "Disconnect Telegram for the signed-in user",
      access: Access.USER,
      execute: async () => {
        const ctx = getCtx();
        await ctx.app.db.exec`DELETE FROM telegram_chat WHERE usr_id = ${ctx.userId}`;
        return { ok: true };
      },
    },
  },

};
