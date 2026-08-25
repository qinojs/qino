import { Access, getCtx } from "@qino/qino";

import { webhook } from "./lib/webhook.ts";
import { linkUrl, userChats } from "./mod.ts";

import type { ApiTree, App } from "@qino/qino";

export { messagingChannel } from "./mod.ts";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

export const settingsSchema = {
  properties: {
    botToken: { type: "string", description: "Bot token from @BotFather — without it the module cannot send or receive" },
    webhookSecret: { type: "string", description: "Secret Telegram echoes back on every update — generated on first use" },
  },
};

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  app.on("route", ({ ctx }) => ctx.req.appPath === "telegram/webhook" ? webhook(ctx) : undefined, { signal });
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
