import { ChannelError } from "@qino/qino/messaging";

import type { App } from "@qino/qino";

export type SmsProvider = { send(to: string, text: string): Promise<unknown> };

const PROVIDER = Symbol("messaging.sms.provider");

export function setProvider(app: App, provider?: SmsProvider): void {
  const owner = app as App & { [PROVIDER]?: SmsProvider };
  provider ? owner[PROVIDER] = provider : delete owner[PROVIDER];
}

export async function deliver(app: App, to: string, text: string): Promise<void> {
  const custom = (app as App & { [PROVIDER]?: SmsProvider })[PROVIDER];
  if (custom) return void await custom.send(to, text);

  const root = app.settings["messaging.sms"].provider;
  const type = String(await root.type ?? "").toLowerCase();
  if (type === "twilio") return twilio(root.twilio, to, text);
  if (type === "http") return http(root.http, to, text);
  throw new ChannelError("messaging.sms: configure provider.type or call setProvider()");
}

async function twilio(settings: Record<string, unknown>, to: string, text: string): Promise<void> {
  const accountSid = String(await settings.accountSid ?? "");
  const apiKeySid = String(await settings.apiKeySid ?? "");
  const apiKeySecret = String(await settings.apiKeySecret ?? "");
  const authToken = String(await settings.authToken ?? "");
  const from = String(await settings.from ?? "");
  const messagingServiceSid = String(await settings.messagingServiceSid ?? "");
  const username = apiKeySid || accountSid;
  const password = apiKeySid ? apiKeySecret : authToken;
  if (!accountSid || !username || !password || (!from && !messagingServiceSid))
    throw new ChannelError("messaging.sms: Twilio needs accountSid, credentials and from or messagingServiceSid");

  const body = new URLSearchParams({ To: to, Body: text });
  from ? body.set("From", from) : body.set("MessagingServiceSid", messagingServiceSid);
  await request(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
    method: "POST",
    headers: {
      authorization: `Basic ${btoa(`${username}:${password}`)}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
}

async function http(settings: Record<string, unknown>, to: string, text: string): Promise<void> {
  const url = String(await settings.url ?? "");
  const token = String(await settings.token ?? "");
  if (!url) throw new ChannelError("messaging.sms: HTTP provider needs a URL");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  await request(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ to, text, from: String(await settings.from ?? "") || undefined }),
  });
}

async function request(url: string, init: RequestInit): Promise<void> {
  const res = await fetch(url, init).catch((e) => {
    throw new ChannelError(`messaging.sms: provider unreachable — ${e instanceof Error ? e.message : e}`);
  });
  if (res.ok) return;
  const detail = (await res.text()).trim().slice(0, 300);
  const message = `messaging.sms: provider returned ${res.status}${detail ? ` — ${detail}` : ""}`;
  // only a plain refusal is about the number; unreachable, unauthorised and throttled are ours
  const ours = res.status >= 500 || [401, 403, 429].includes(res.status);
  throw ours ? new ChannelError(message) : new Error(message);
}
