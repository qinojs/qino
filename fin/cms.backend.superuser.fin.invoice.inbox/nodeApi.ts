import { errMsg } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";

import { update } from "@qino/qino/fin.invoice";

import { read, supplierOf } from "./lib/read.ts";

import type { Node } from "@qino/qino/cms";

type Sent = { name: string; type: string; data: string };

/** Node access is the permission — whoever may open this page may read invoices in. */
export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  const app = node.app;
  const t = app.t;
  if (vars.supplier) return await supplier(node, Number(vars.supplier));
  if (!vars.read) return null;
  const done: number[] = [];
  const failed: string[] = [];
  // one after the other: each is a call to the model, and one failure leaves the others
  for (const sent of vars.read as Sent[]) {
    try {
      const bytes = Uint8Array.fromBase64(String(sent.data));
      const file = await app.dbFiles.add(new File([bytes], sent.name || "invoice", { type: sent.type }));
      // a file that could not be read is no receipt of anything
      done.push(await read(app, file).catch(async (e) => {
        await file.remove();
        throw e;
      }));
    } catch (e) {
      failed.push(`${sent.name}: ${errMsg(e)}`);
    }
  }
  const message = [`${done.length} ${await t`read`}`, ...failed].join("\n");
  // one invoice: straight to it
  if (done.length === 1 && !failed.length) {
    const url = (await backend.toModuleUrl(node, "cms.backend.superuser.fin.invoice"))({ invoice: done[0] });
    if (url) return { ok: true, url };
  }
  return { ok: !failed.length || done.length > 0, message };
}

/** A draft's supplier: found among the users, else made one — without a login — from what was read. */
async function supplier(node: Node, id: number) {
  const app = node.app;
  const invoice = await app.db.row`SELECT party FROM invoice WHERE id = ${id} AND status = 'draft'`;
  if (!invoice) return { ok: false, message: await app.t`No draft` };
  const party = JSON.parse(String(invoice.party ?? "{}")) ?? {};
  const a = party.address ?? {};
  const found = await supplierOf(app, party);
  const usrId = found ?? Number(await app.db.table("usr").insert({
    organization: party.name ?? "",
    given_name: "",
    family_name: "",
    street_address: a.streetAddress ?? "",
    postal_code: a.postalCode ?? "",
    address_locality: a.addressLocality ?? "",
    address_region: a.addressRegion ?? "",
    address_country: a.addressCountry ?? "",
    iban: party.iban || null,
    active: 0,
    pw: "",
    superuser: 0,
  }));
  // a supplier found by name learns the account it is paid into
  if (found && party.iban) await app.db.exec`UPDATE usr SET iban = ${party.iban} WHERE id = ${found} AND iban IS NULL`;
  await update(app, id, { usrId });
  return { ok: true, message: found ? await app.t`Linked to its user.` : await app.t`Supplier created.` };
}
