import { $item, contactOwner, errMsg } from "@qino/qino";
import { approvePhone, removePhone, send, setMainPhone } from "@qino/qino/messaging.sms";

import type { Node } from "@qino/qino/cms";

/** Node access is the permission — whoever may read this backend node may manage SMS. */
export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  const app = node.app;
  try {
    if (vars.providerSave) {
      await saveProvider(app, vars.providerSave as Record<string, unknown>);
      return { ok: true, message: await app.t`Provider saved.` };
    }
    if (vars.approve) {
      const { usr, number } = vars.approve as { usr: string; number: string };
      await approvePhone(app, Number(usr), String(number));
      return { ok: true, message: await app.t`Phone number approved.` };
    }
    if (vars.main) {
      const number = String(vars.main);
      const usrId = await contactOwner(app.db, "phone", number);
      if (!usrId) return { ok: false, message: await app.t`Phone number not found.` };
      await setMainPhone(app, usrId, number);
      return { ok: true, message: await app.t`Main number changed.` };
    }
    if (vars.delete) {
      const number = String(vars.delete);
      const usrId = await contactOwner(app.db, "phone", number);
      if (usrId) await removePhone(app, usrId, number);
      return { ok: true, message: await app.t`Phone number deleted.` };
    }
    if (vars.test) {
      const sent = await send(app, { phone: String(vars.test) }, await app.t`Test message`);
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
    return { ok: false, message: errMsg(e) };
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
