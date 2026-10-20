import { backend } from "@qino/qino/cms.backend";
import { KINDS, link, prune, remove, save, sync, unlink } from "@qino/qino/fin.hosting";

import type { Node } from "@qino/qino/cms";
import type { Kind } from "@qino/qino/fin.hosting";

/** Node access is the permission — whoever may open this page may keep the domains. A refusal of
 *  fin.hosting (no domain, an alias of an alias, held) comes back as the message. */
export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  const app = node.app;
  const t = app.t;
  try {
    if (vars.save) {
      const v = vars.save as Record<string, string>;
      // a new one has its name typed; a changed one carries it in data-save
      const name = await save(app, v.id || v.name, {
        // an alias's form has no customer and no host: it takes its domain's
        ...("usrId" in v ? { usrId: Number(v.usrId) || null } : {}),
        ...("host" in v ? { host: v.host || null, hostingFree: v.hostingFree === "1" } : {}),
        aliasOf: v.aliasOf || null,
        registrar: v.registrar ?? null,
        domainFree: v.domainFree === "1",
      });
      if (v.id) return { ok: true, message: await t`Saved.` };
      return { ok: true, url: backend.toUrl(await (await node.page()).url(), { domain: name }) };
    }
    if (vars.sync) {
      const report = await sync(app);
      const lines = await Promise.all(report.map(async (r) => r.error
        ? `${r.name}: ${r.error}`
        : `${r.name}: ${r.found} ${await t`found`}, ${r.added} ${await t`new`}, ${r.gone} ${await t`gone`}`
          + (r.failed ? `\n${r.failed.join("\n")}` : "")));
      return { ok: true, message: lines.join("\n") || await t`Nothing to sync` };
    }
    if (vars.prune) {
      const names = await prune(app);
      return { ok: true, message: `${names.length} ${await t`removed`}${names.length ? `: ${names.join(", ")}` : ""}` };
    }
    if (typeof vars.remove === "string") {
      await remove(app, vars.remove);
      return { ok: true, url: await (await node.page()).url() };
    }
    if (vars.link) {
      const v = vars.link as Record<string, string>;
      await link(app, v.id, Number(v.subscription), KINDS.find((k) => k === v.kind) as Kind | undefined);
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
