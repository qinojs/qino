import { backend } from "@qino/qino/cms.backend";

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
] as const;

const valuesOf = (v: Record<string, string>) =>
  Object.fromEntries(FIELDS.map((key) => [key, (key === "address_country" ? v[key]?.toUpperCase() : v[key]) ?? ""]));

/** Node access is the permission — whoever may open this backend page may keep these addresses. */
export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  const app = node.app;
  const t = app.t;
  // a supplier is a user without a login: inactive, no password
  if (vars.create) {
    const values = valuesOf(vars.create as Record<string, string>);
    if (!values.organization && !values.family_name) return { ok: false, message: await t`A name, please` };
    const id = await app.db.table("usr").insert({ ...values, active: 0, pw: "", superuser: 0 });
    const url = backend.toUrl(await (await node.page()).url(), { usr: id });
    return { ok: true, url };
  }
  if (vars.save) {
    const v = vars.save as Record<string, string>;
    await app.db.table("usr").update(Number(v.id), valuesOf(v));
    return { ok: true, message: await t`Saved.` };
  }
  return null;
}
