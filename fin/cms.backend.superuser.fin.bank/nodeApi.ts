import { errMsg } from "@qino/qino";
import { assign } from "@qino/qino/fin.bank";

import type { Node } from "@qino/qino/cms";

/** Node access is the permission — whoever may open this backend page may read statements and assign lines. */
export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  const app = node.app;
  const t = app.t;
  try {
    if (vars.camt) {
      // an importer is optional; without it there is nothing to read with
      const { ingest } = await import("@qino/qino/fin.bank.camt");
      let added = 0, matched = 0;
      for (const xml of [vars.camt].flat()) {
        const result = await ingest(app, String(xml));
        added += result.added;
        matched += result.matched;
      }
      return { ok: true, message: `${added} ${await t`new lines`}, ${matched} ${await t`payments settled`}` };
    }
    if (vars.assign) {
      const { id, ref } = vars.assign as { id: string; ref: string };
      const payment = await assign(app, Number(id), String(ref).trim());
      return { ok: true, message: `${await t`Recorded as payment`} #${payment}` };
    }
    return null;
  } catch (e) {
    return { ok: false, message: errMsg(e) };
  }
}
