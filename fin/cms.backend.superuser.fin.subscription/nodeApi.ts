import { toMinor } from "@qino/qino/cms.backend.superuser.fin";
import { bill, cancel, plan, plans, subscribe, update } from "@qino/qino/fin.subscription";

import type { Node } from "@qino/qino/cms";

/** The terms typed: price, currency, tax, period — empty ones `null`, to take the plan's. */
function termsOf(v: Record<string, string>, fallbackCurrency = "CHF") {
  const currency = String(v.currency ?? "").toUpperCase();
  const decimal = (value: string) => Number(value.replace(",", "."));
  return {
    price: v.price ? toMinor(v.price, currency || fallbackCurrency) : null,
    currency: currency || null,
    taxRate: v.taxRate ? decimal(v.taxRate) : null,
    unit: v.unit === "month" || v.unit === "year" ? v.unit : null,
    count: Number(v.count) || null,
  } as const;
}

/** Node access is the permission — whoever may open this page may keep subscriptions. */
export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  const app = node.app;
  const t = app.t;
  // the plan's currency, for a price typed without one
  const currencyOf = async (planId: unknown) =>
    String((await plans(app)).find((p) => Number(p.id) === Number(planId))?.currency ?? "CHF");
  if (vars.subscribe) {
    const v = vars.subscribe as Record<string, string>;
    await subscribe(app, {
      usrId: Number(v.usrId),
      planId: Number(v.planId) || null,
      name: v.name,
      description: v.description || null,
      ...termsOf(v, await currencyOf(v.planId)),
      start: v.start,
    });
    return { ok: true };
  }
  if (vars.update) {
    const v = vars.update as Record<string, string>;
    await update(app, Number(v.id), {
      planId: Number(v.planId) || null,
      name: v.name,
      description: v.description || null,
      ...termsOf(v, await currencyOf(v.planId)),
      ...v.start ? { start: v.start } : {}, // locked once billed: not sent then
      end: v.end || null,
    });
    return { ok: true, message: await t`Saved.` };
  }
  if (vars.plan) {
    const v = vars.plan as Record<string, string>;
    const terms = termsOf(v);
    if (terms.price == null || !terms.currency) {
      return { ok: false, message: await t`A plan needs a price and currency.` };
    }
    await plan(app, {
      id: Number(v.id) || undefined,
      name: v.name,
      description: v.description || null,
      price: terms.price,
      currency: terms.currency,
      taxRate: terms.taxRate,
      unit: terms.unit ?? "year",
      count: terms.count ?? 1,
    });
    return { ok: true };
  }
  if (vars.removePlan) {
    const id = Number(vars.removePlan);
    if (await app.db.one`SELECT 1 FROM subscription WHERE plan_id = ${id}`) {
      return { ok: false, message: await t`It has subscriptions.` };
    }
    await app.db.table("subscription_plan").delete(id);
    return { ok: true };
  }
  if (vars.cancel) {
    await cancel(app, Number(vars.cancel));
    return { ok: true, message: await t`Ends with the period under way.` };
  }
  // one never billed may go: it was a mistake
  if (vars.remove) {
    const id = Number(vars.remove);
    if (await app.db.one`SELECT 1 FROM subscription_invoice WHERE subscription_id = ${id}`) {
      return { ok: false, message: await t`It was billed already: cancel it instead.` };
    }
    await app.db.table("subscription").delete(id);
    return { ok: true };
  }
  if (vars.bill) {
    const ids = await bill(app);
    return { ok: true, message: `${ids.length} ${await t`invoices`}` };
  }
  return null;
}
