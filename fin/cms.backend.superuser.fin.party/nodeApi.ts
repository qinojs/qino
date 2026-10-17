import { backend } from "@qino/qino/cms.backend";
import { addUser, parseAmount } from "@qino/qino/cms.backend.superuser.fin";

import type { Node } from "@qino/qino/cms";

/** What the page writes on a user: their name and postal address (fin's columns). */
const FIELDS = [
  "given_name",
  "family_name",
  "organization",
  "street_address",
  "postal_code",
  "address_locality",
  "address_region",
  "address_country",
  "iban",
] as const;

/** Country upper case, the IBAN without spaces (none: null, it is looked up). */
const clean = (key: string, value = "") =>
  key === "address_country"
    ? value.toUpperCase()
    : key === "iban"
    ? value.replace(/\s+/g, "").toUpperCase() || null
    : value;

const valuesOf = (v: Record<string, string>) => Object.fromEntries(FIELDS.map((key) => [key, clean(key, v[key])]));

/** Node access is the permission — whoever may open this backend page may keep these addresses. */
export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  const app = node.app;
  const t = app.t;
  if (vars.create) {
    const values = valuesOf(vars.create as Record<string, string>);
    if (!values.organization && !values.family_name) return { ok: false, message: await t`A name, please` };
    const id = await addUser(app, values);
    const url = backend.toUrl(await (await node.page()).url(), { usr: id });
    return { ok: true, url };
  }
  // credit added by hand (or taken, negative): a goodwill, money paid in for it
  if (vars.credit) {
    const v = vars.credit as Record<string, string>;
    const currency = String(v.currency ?? "").toUpperCase();
    const { add } = await import("@qino/qino/fin.payment.credit");
    await add(app, Number(v.id), { amount: parseAmount(v.amount, currency), currency, text: v.text });
    return { ok: true };
  }
  if (vars.save) {
    const v = vars.save as Record<string, string>;
    await app.db.table("usr").update(Number(v.id), valuesOf(v));
    return { ok: true, message: await t`Saved.` };
  }
  return null;
}
