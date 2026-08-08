import type { Node } from "../cms/mod.ts";
import { deleteWebhook, removeChat, send, setWebhook } from "../messaging.telegram/mod.ts";
import { webhookUrl } from "./render.ts";

/** Node access is the permission — whoever may read this backend node may send from here. */
export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  const app = node.app;
  try {
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
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
