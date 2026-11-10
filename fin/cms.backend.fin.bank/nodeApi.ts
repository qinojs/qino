import { errMsg } from "@qino/qino";
import { assign } from "@qino/qino/fin.bank";

import type { Node } from "@qino/qino/cms";
import type { Step } from "@qino/qino/fin.bank.ebics";

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
    if (vars.ebics) {
      const step = String(vars.ebics);
      if (step === "sync") {
        const { trigger } = await import("@qino/qino/cron");
        const { failed } = await trigger(app, "fin.bank.ebics:download");
        const error = Object.values(failed)[0];
        return error ? { ok: false, message: error } : { ok: true, message: await t`Downloaded` };
      }
      if (!["keys", "ini", "hia", "hpb"].includes(step)) return null;
      const { enrol } = await import("@qino/qino/fin.bank.ebics");
      const result = await enrol(app, step as Step);
      // the fingerprints go in the bank's letter, so they are shown as they are
      return { ok: true, message: result ? Object.entries(result).map(([k, v]) => `${k}: ${v}`).join("\n") : await t`Accepted` };
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
