import type { Node } from "@qino/qino/cms";
import { $item, errMsg } from "@qino/qino";
import { bot, deleteWebhook, removeChat, send, setWebhook } from "@qino/qino/messaging.telegram";
import { webhookUrl } from "./render.ts";

/** Node access is the permission — whoever may read this backend node may send from here. */
export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  const app = node.app;
  try {
    if (vars.botToken != null) {
      const token = String(vars.botToken).trim();
      if (!token) return { ok: false, message: await app.t`A bot token is required.` };
      const setting = app.settings[$item].sub(["messaging.telegram"]).item("botToken");
      const previous = await app.settings["messaging.telegram"].botToken;
      if (previous) return { ok: false, message: await app.t`The bot token is already configured.` };
      await setting.set(token);
      try {
        await bot(app);
      } catch (e) {
        previous == null ? await setting.remove() : await setting.set(previous);
        throw e;
      }
      return { ok: true, message: await app.t`Bot token saved.` };
    }
    if (vars.webhookSet) {
      await setWebhook(app, webhookUrl());
      return { ok: true, message: await app.t`Webhook registered.` };
    }
    if (vars.webhookDelete) {
      await deleteWebhook(app);
      return { ok: true, message: await app.t`Webhook removed.` };
    }
    if (vars.delete) {
      await removeChat(app, Number(vars.delete));
      return { ok: true, message: await app.t`Chat disconnected.` };
    }
    if (vars.test) {
      const sent = await send(app, { chat: Number(vars.test) }, { text: await app.t`Test message` });
      return sent
        ? { ok: true, message: await app.t`Sent.` }
        : { ok: false, message: await app.t`Not delivered — the chat was dropped.` };
    }
    if (vars.send) {
      const { to, text, html } = vars.send as { to: string; text: string; html?: boolean };
      if (!text) return { ok: false, message: await app.t`A text is required.` };
      const [kind, value] = to.split(":");
      const recipient = kind === "grp" ? { grp: Number(value) }
        : kind === "usr" ? { usr: Number(value) }
        : { all: true } as const;
      const sent = await send(app, recipient, html ? { text, parse_mode: "HTML" } : { text });
      return { ok: true, message: await app.t`Delivered to ${sent} chats.` };
    }
    return null;
  } catch (e) {
    return { ok: false, message: errMsg(e) };
  }
}
