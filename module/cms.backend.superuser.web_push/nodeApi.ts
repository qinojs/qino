import type { Node } from "../cms/mod.ts";
import { push } from "../messaging.web_push/mod.ts";

/** Node access is the permission — whoever may read this backend node may send from here. */
export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  const app = node.app;
  try {
    if (vars.channelAdd) {
      const name = String(vars.channelAdd).trim();
      if (!name) return { ok: false, message: await app.t`A name is required.` };
      if (await app.db.one`SELECT id FROM web_push_channel WHERE name = ${name}`) {
        return { ok: false, message: await app.t`That channel already exists.` };
      }
      await app.db.table("web_push_channel").insert({ name });
      return { ok: true, message: await app.t`Channel added.` };
    }
    if (vars.channelDelete) {
      await app.db.table("web_push_channel").delete(Number(vars.channelDelete));
      return { ok: true, message: await app.t`Channel deleted.` };
    }
    if (vars.delete) {
      await app.db.table("web_push_subscription").delete(Number(vars.delete));
      return { ok: true, message: await app.t`Subscription deleted.` };
    }
    if (vars.test) {
      const sent = await push(app, { sub: Number(vars.test) }, { title: await app.t`Test notification` });
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
      const sent = await push(app, recipient, { title, body, url });
      return { ok: true, message: await app.t`Delivered to ${sent} browsers.` };
    }
    return null;
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
