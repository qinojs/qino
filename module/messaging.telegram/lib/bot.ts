import { $item, randB64 } from "@qino/qino";

import type { App } from "@qino/qino";

// Module-internal: everything here carries the bot token. mod.ts exposes only what is safe to show.

/** A call Telegram did not answer `ok` — `retryAfter` is set on 429. */
export class BotError extends Error {
  status: number;
  retryAfter: number | undefined;
  constructor(message: string, status: number, retryAfter?: number) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export async function botToken(app: App): Promise<string> {
  const token = String(await app.settings["messaging.telegram"].botToken ?? "");
  if (!token) throw new Error("messaging.telegram: set botToken to the token @BotFather handed you");
  return token;
}

/** Call a Bot API method. */
// deno-lint-ignore no-explicit-any
export async function call(app: App, method: string, params: Record<string, unknown> = {}): Promise<any> {
  const res = await fetch(`https://api.telegram.org/bot${await botToken(app)}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => ({}));
  // error_code is the authoritative one — Telegram mirrors it into the HTTP status, proxies may not
  if (!data.ok) throw new BotError(data.description || `telegram ${method} failed`, data.error_code || res.status, data.parameters?.retry_after);
  return data.result;
}

// The bot behind a token never changes, so it is cached — with the token, so a changed setting refetches.
// deno-lint-ignore no-explicit-any
const identities = new WeakMap<App, { token: string; me: Promise<any> }>();

/** The bot behind the configured token: `id`, `username`, `first_name`, … */
// deno-lint-ignore no-explicit-any
export async function getMe(app: App): Promise<any> {
  const token = await botToken(app);
  let known = identities.get(app);
  if (known?.token !== token) {
    known = { token, me: call(app, "getMe") };
    known.me.catch(() => identities.delete(app));
    identities.set(app, known);
  }
  return known.me;
}

const secrets = new WeakMap<App, Promise<string>>();

/** The secret Telegram echoes back in `X-Telegram-Bot-Api-Secret-Token` — made on first use. */
export function webhookSecret(app: App): Promise<string> {
  return secrets.getOrInsertComputed(app, () => loadSecret(app).catch((e) => { secrets.delete(app); throw e; }));
}

async function loadSecret(app: App) {
  const stored = String(await app.settings["messaging.telegram"].webhookSecret ?? "");
  if (stored) return stored;
  const fresh = randB64(24); // base64url is exactly the alphabet Telegram accepts here
  // writing goes through the raw item — on the proxy, .set would read as a child key
  await app.settings[$item].sub(["messaging.telegram"]).item("webhookSecret").set(fresh);
  return fresh;
}
