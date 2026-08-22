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
      await saveSettings(app, vars.settings as Record<string, unknown>);
      return { ok: true, message: await app.t`Saved.` };
    }
    if (vars.fetch) {
      const taken = await receive(app);
      return { ok: true, message: await app.t`${taken} messages taken over.` };
    }
    if (vars.inboundTest) {
      await receive(app, { probe: true });
      return { ok: true, message: await app.t`Connected.` };
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
    if (vars.test != null) {
      if (!vars.test) return { ok: false, message: await app.t`A system address is required.` };
      let error = "";
      await send(app, { email: String(vars.test) }, await app.t`Test message`, { onError: (message) => error ||= message });
      return error ? { ok: false, message: error } : { ok: true, message: await app.t`Sent.` };
    }
    if (vars.send) {
      const { to, address, title, text, format, template, attachments } = vars.send as Record<string, unknown>;
      if (!text) return { ok: false, message: await app.t`A text is required.` };
      const [kind, value] = String(to).split(":");
      const recipient = kind === "grp" ? { grp: Number(value) }
        : kind === "usr" ? { usr: Number(value) }
        : kind === "address" ? { email: String(address) }
        : { all: true } as const;
      if (kind === "address" && !address) return { ok: false, message: await app.t`An address is required.` };
      const sent = await send(app, recipient, {
        text: String(text),
        title: title ? String(title) : undefined,
        format: format === "md" || format === "html" ? format : undefined,
        template: template === "-" ? "" : template ? String(template) : undefined,
        attachments: await attachmentsOf(attachments),
      });
      return { ok: true, message: await app.t`Delivered to ${sent} addresses.` };
    }
    return null;
  } catch (e) {
    return { ok: false, message: errMsg((e as { responseText?: unknown })?.responseText || e).trim() || "Email operation failed." };
  }
}

/** Decode the JSON wire form used by this panel into standard files for messaging. */
export async function attachmentsOf(input: unknown): Promise<File[]> {
  if (input == null) return [];
  if (!Array.isArray(input)) throw new ApiError(422, "Invalid attachments");
  return await Promise.all(input.map(async (value) => {
    if (!value || typeof value !== "object") throw new ApiError(422, "Invalid attachment");
    const attachment = value as Record<string, unknown>;
    const name = String(attachment.name ?? "").trim();
    const content = String(attachment.content ?? "");
    if (!name || name.length > 255 || /[\r\n]/.test(name) || !content.startsWith("data:")) throw new ApiError(422, "Invalid attachment");
    const blob = await (await fetch(content)).blob();
    const type = String(attachment.type || blob.type);
    if (type.length > 100 || /[\r\n]/.test(type)) throw new ApiError(422, "Invalid attachment type");
    return new File([blob], name, { type });
  }));
}

/** Writes what the schema knows and nothing else; an empty secret keeps what is stored. */
async function saveSettings(app: App, values: Record<string, unknown>) {
  const known = new Map(leaves(schema(app)).map((leaf) => [leaf.path, leaf.schema]));
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
  }
}
