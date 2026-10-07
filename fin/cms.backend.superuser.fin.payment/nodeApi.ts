import { errMsg } from "@qino/qino";
import { toMinor } from "@qino/qino/cms.backend.superuser.fin";
import { record, refund, sync } from "@qino/qino/fin.payment";

import type { Node } from "@qino/qino/cms";

/** Node access is the permission — whoever may open this backend page may act on payments. */
export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  const app = node.app;
  try {
    if (vars.sync) {
      const row = await sync(app, Number(vars.sync));
      return { ok: true, message: `${await app.t`The provider says`}: ${row?.status}` };
    }
    if (vars.refund) {
      const { id, amount } = vars.refund as { id: string; amount: string };
      const row = await app.db.row`SELECT currency FROM payment WHERE id = ${Number(id)}`;
      if (!row) return { ok: false, message: await app.t`No payment` };
      await refund(app, Number(id), amount ? toMinor(amount, String(row.currency)) : undefined);
      return { ok: true, message: await app.t`Paid back.` };
    }
    if (vars.record) {
      const v = vars.record as Record<string, string>;
      const currency = String(v.currency ?? "").toUpperCase();
      const id = await record(app, {
        direction: v.direction === "out" ? "out" : "in",
        provider: v.provider,
        amount: toMinor(v.amount, currency),
        currency,
        ref: v.ref || undefined,
        title: v.title || undefined,
      });
      return { ok: true, message: `${await app.t`Recorded as payment`} #${id}` };
    }
    return null;
  } catch (e) {
    return { ok: false, message: errMsg(e) };
  }
}
