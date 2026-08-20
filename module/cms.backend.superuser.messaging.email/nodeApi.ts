import { $item, addContact, ApiError, contactOwner, errMsg, removeContact, setMainContact } from "@qino/qino";
import { dropClaim } from "@qino/qino/messaging";
import { receive, send } from "@qino/qino/messaging.email";

import { isSecret, leaves, schema } from "./render.ts";

import type { App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const CONTACT = "email";

/** Node access is the permission — whoever may read this backend node may manage mail. */
export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  const app = node.app;
  try {
    if (vars.settings) {
      const saved = await saveSettings(app, vars.settings as Record<string, unknown>);
      return { ok: true, message: await app.t`${saved} settings saved.` };
    }
    if (vars.fetch) {
      const taken = await receive(app);
      return { ok: true, message: await app.t`${taken} messages taken over.` };
    }
    if (vars.contactAdd) {
      const { usr, address } = vars.contactAdd as { usr: string; address: string };
      await addContact(app.db, Number(usr), CONTACT, String(address));
      return { ok: true, message: await app.t`Address added.` };
    }
    if (vars.approve) {
      const { usr, address } = vars.approve as { usr: string; address: string };
      const claimed = await dropClaim(app, CONTACT, Number(usr), String(address));
      if (!claimed) return { ok: false, message: await app.t`Nothing to verify.` };
      await addContact(app.db, Number(claimed.usr_id), CONTACT, String(claimed.address));
      return { ok: true, message: await app.t`Address approved.` };
    }
    if (vars.main) {
      const address = String(vars.main);
      const usrId = await contactOwner(app.db, CONTACT, address);
      if (!usrId) return { ok: false, message: await app.t`Address not found.` };
      await setMainContact(app.db, usrId, CONTACT, address);
      return { ok: true, message: await app.t`Main address changed.` };
    }
    if (vars.delete) {
      const address = String(vars.delete);
      const usrId = await contactOwner(app.db, CONTACT, address);
      if (usrId) await removeContact(app.db, usrId, CONTACT, address);
      return { ok: true, message: await app.t`Address deleted.` };
    }
    if (vars.test) {
      const sent = await send(app, { email: String(vars.test) }, await app.t`Test message`);
      return sent
        ? { ok: true, message: await app.t`Sent.` }
        : { ok: false, message: await app.t`Not delivered.` };
    }
    if (vars.send) {
      const { to, address, title, text, format, template } = vars.send as Record<string, string>;
      if (!text) return { ok: false, message: await app.t`A text is required.` };
      const [kind, value] = String(to).split(":");
      const recipient = kind === "grp" ? { grp: Number(value) }
        : kind === "usr" ? { usr: Number(value) }
        : kind === "address" ? { email: address }
        : { all: true } as const;
      if (kind === "address" && !address) return { ok: false, message: await app.t`An address is required.` };
      const sent = await send(app, recipient, {
        text,
        title: title || undefined,
        format: format === "md" || format === "html" ? format : undefined,
        template: template === "-" ? "" : template || undefined,
      });
      return { ok: true, message: await app.t`Delivered to ${sent} addresses.` };
    }
    return null;
  } catch (e) {
    return { ok: false, message: errMsg(e) };
  }
}

/** Writes what the schema knows and nothing else; an empty secret keeps what is stored. */
async function saveSettings(app: App, values: Record<string, unknown>): Promise<number> {
  const known = new Map(leaves(schema(app)).map((leaf) => [leaf.path, leaf.schema]));
  let saved = 0;
  for (const [path, input] of Object.entries(values)) {
    const leaf = known.get(path);
    if (!leaf) throw new ApiError(422, `Unknown setting ${path}`);
    const raw = typeof input === "string" ? input.trim() : input;
    if (isSecret(path) && raw === "") continue;
    const value = leaf.type === "boolean" ? raw === true || raw === "true"
      : leaf.type === "number" ? (raw === "" ? "" : Number(raw))
      : String(raw);
    const keys = path.split(".");
    await app.settings[$item].sub(["messaging.email", ...keys.slice(0, -1)]).item(keys.at(-1)!).set(value);
    saved++;
  }
  return saved;
}
