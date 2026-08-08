import type { Node } from "../cms/mod.ts";
import { send } from "../messaging.telegram/mod.ts";

/** Node access is the permission — replies are limited to an existing user. */
export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  if (!vars.telegramReply) return null;
  const app = node.app;
  try {
    if (!app.modules.get("messaging.telegram")) return { ok: false, message: await app.t`Telegram is not enabled.` };
    const { usr, text: input } = vars.telegramReply as { usr: unknown; text: unknown };
    const usrId = Number(usr);
    const text = String(input ?? "").trim();
    if (!Number.isSafeInteger(usrId) || usrId < 1 || !await app.db.one`SELECT id FROM usr WHERE id = ${usrId}`) {
      return { ok: false, message: await app.t`User not found.` };
    }
    if (!text) return { ok: false, message: await app.t`A text is required.` };
    if (text.length > 4096) return { ok: false, message: await app.t`The message is too long.` };
    const sent = await send(app, { usr: usrId }, { text });
    return sent
      ? { ok: true, message: await app.t`Delivered to ${sent} chats.` }
      : { ok: false, message: await app.t`No Telegram chat reached.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
