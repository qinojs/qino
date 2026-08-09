import type { Node } from "../cms/mod.ts";
import { $item } from "../core/mod.ts";
import { approvePhone, removePhone, send, setMainPhone } from "../messaging.sms/mod.ts";

/** Node access is the permission — whoever may read this backend node may manage SMS. */
export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  const app = node.app;
  try {
    if (vars.providerSave) {
      await saveProvider(app, vars.providerSave as Record<string, unknown>);
      return { ok: true, message: await app.t`Provider saved.` };
    }
    if (vars.approve) {
      await approvePhone(app, String(vars.approve));
      return { ok: true, message: await app.t`Phone number approved.` };
    }
    if (vars.main) {
      const id = Number(vars.main);
      const usrId = await app.db.one`SELECT usr_id FROM usr_phone WHERE id = ${id}`;
      if (!usrId) return { ok: false, message: await app.t`Phone number not found.` };
      await setMainPhone(app, Number(usrId), id);
      return { ok: true, message: await app.t`Main number changed.` };
    }
    if (vars.delete) {
      const id = Number(vars.delete);
      const usrId = await app.db.one`SELECT usr_id FROM usr_phone WHERE id = ${id}`;
      if (usrId) await removePhone(app, Number(usrId), id);
      return { ok: true, message: await app.t`Phone number deleted.` };
    }
    if (vars.test) {
      const sent = await send(app, { phone: Number(vars.test) }, await app.t`Test message`);
      return sent
        ? { ok: true, message: await app.t`Sent.` }
        : { ok: false, message: await app.t`Not delivered.` };
    }
    if (vars.send) {
      const { to, text } = vars.send as { to: string; text: string };
      if (!text) return { ok: false, message: await app.t`A text is required.` };
      const [kind, value] = to.split(":");
      const recipient = kind === "grp" ? { grp: Number(value) }
        : kind === "usr" ? { usr: Number(value) }
        : { all: true } as const;
      const sent = await send(app, recipient, text);
      return { ok: true, message: await app.t`Delivered to ${sent} phones.` };
    }
    return null;
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

async function saveProvider(app: Node["app"], values: Record<string, unknown>): Promise<void> {
  const type = String(values.type ?? "");
  if (type !== "twilio" && type !== "http") throw new Error("Choose an SMS provider");
  const root = app.settings[$item].sub(["messaging.sms", "provider"]);
  await root.item("type").set(type);
  const save = async (provider: string, name: string, value: unknown, secret = false) => {
    const text = String(value ?? "").trim();
    if (!secret || text) await root.sub([provider]).item(name).set(text);
  };
  await save("twilio", "accountSid", values.accountSid);
  await save("twilio", "apiKeySid", values.apiKeySid);
  await save("twilio", "apiKeySecret", values.apiKeySecret, true);
  await save("twilio", "authToken", values.authToken, true);
  await save("twilio", "from", values.twilioFrom);
  await save("twilio", "messagingServiceSid", values.messagingServiceSid);
  await save("http", "url", values.url);
  await save("http", "token", values.httpToken, true);
  await save("http", "from", values.httpFrom);
}
