import { backend } from "@qino/qino/cms.backend";
import { link, remove, save, sync, unlink } from "@qino/qino/fin.hosting";

import type { Node } from "@qino/qino/cms";

/** Node access is the permission — whoever may open this page may keep the domains. A refusal of
 *  fin.hosting (no domain, an alias of an alias, held) comes back as the message. */
export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  const app = node.app;
  try {
    if (vars.save) {
      const v = vars.save as Record<string, string>;
      // a new one has its name typed; a changed one carries it in data-save
      const name = await save(app, v.id || v.name, {
        // an alias's form has no customer: it takes its domain's
        ...("usrId" in v ? { usrId: Number(v.usrId) || null } : {}),
        aliasOf: v.aliasOf || null,
        registrar: v.registrar ?? null,
        free: v.free === "1",
      });
      if (v.id) return { ok: true, message: await app.t`Saved.` };
      return { ok: true, url: backend.toUrl(await (await node.page()).url(), { domain: name }) };
    }
    if (vars.sync) {
      const report = await sync(app);
      const t = app.t;
      const lines = await Promise.all(report.map(async (r) => r.error
        ? `${r.registrar}: ${r.error}`
        : `${r.registrar}: ${r.found} ${await t`found`}, ${r.added} ${await t`new`}, ${r.gone} ${await t`gone`}`));
      return { ok: true, message: lines.join("\n") };
    }
    if (typeof vars.remove === "string") {
      await remove(app, vars.remove);
      return { ok: true, url: await (await node.page()).url() };
    }
    if (vars.link) {
      const v = vars.link as Record<string, string>;
      await link(app, v.id, Number(v.subscription));
      return { ok: true };
    }
    if (vars.unlink) {
      const v = vars.unlink as Record<string, string>;
      await unlink(app, v.id, Number(v.subscription));
      return { ok: true };
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message.replace(/^fin\.hosting: /, "") : String(e) };
  }
  return null;
}
