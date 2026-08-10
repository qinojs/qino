import type { Node } from "../cms/mod.ts";
import { channel } from "../messaging/mod.ts";
import { errMsg } from "../core/mod.ts";

/** Node access is the permission — replies are limited to an existing user. */
export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  if (!vars.reply && !vars.telegramReply) return null;
  const app = node.app;
  try {
    const legacy = vars.telegramReply;
    const { usr, channel: inputChannel, text: input } = (vars.reply ?? legacy) as Record<string, unknown>;
    const usrId = Number(usr);
    const name = legacy ? "telegram" : String(inputChannel ?? "");
    const text = String(input ?? "").trim();
    const user = Number.isSafeInteger(usrId) && usrId > 0
      ? await app.db.row`SELECT id FROM usr WHERE id = ${usrId}`
      : undefined;
    if (!user) return { ok: false, message: await app.t`User not found.` };
    if (!text) return { ok: false, message: await app.t`A text is required.` };
    if (text.length > 4096) return { ok: false, message: await app.t`The message is too long.` };

    const to = channel(app, name);
    if (!to) return { ok: false, message: await app.t`Channel is not available.` };
    const sent = await to.send(app, { usr: usrId }, text);
    return sent
      ? { ok: true, message: await app.t`Delivered over ${to.label} (${sent}).` }
      : { ok: false, message: await app.t`${to.label} reached nobody.` };
  } catch (e) {
    return { ok: false, message: errMsg(e) };
  }
}
