import type { Node } from "@qino/qino/cms";
import { addChannel, removeChannel, removeSubscription, send } from "@qino/qino/messaging.web_push";
import { errMsg } from "@qino/qino";

/** Node access is the permission — whoever may read this backend node may send from here. */
export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  const app = node.app;
  try {
    if (vars.channelAdd) {
      const name = String(vars.channelAdd).trim();
      if (!name) return { ok: false, message: await app.t`A name is required.` };
      return await addChannel(app, name)
        ? { ok: true, message: await app.t`Channel added.` }
        : { ok: false, message: await app.t`That channel already exists.` };
    }
    if (vars.channelDelete) {
      await removeChannel(app, Number(vars.channelDelete));
      return { ok: true, message: await app.t`Channel deleted.` };
    }
    if (vars.delete) {
      await removeSubscription(app, Number(vars.delete));
      return { ok: true, message: await app.t`Subscription deleted.` };
    }
    if (vars.test) {
      const sent = await send(app, { sub: Number(vars.test) }, await app.t`Test notification`);
      return sent
        ? { ok: true, message: await app.t`Sent.` }
        : { ok: false, message: await app.t`Not delivered — the subscription was dropped.` };
    }
    if (vars.send) {
      const { to, title, body, url } = vars.send as { to: string; title: string; body?: string; url?: string };
      if (!title) return { ok: false, message: await app.t`A title is required.` };
      const [kind, value] = to.split(":");
      const recipient = kind === "channel" ? { channel: value }
        : kind === "grp" ? { grp: Number(value) }
        : kind === "usr" ? { usr: Number(value) }
        : { all: true } as const;
      const sent = await send(app, recipient, { title, text: body ?? "", url });
      return { ok: true, message: await app.t`Delivered to ${sent} browsers.` };
    }
    return null;
  } catch (e) {
    return { ok: false, message: errMsg(e) };
  }
}
