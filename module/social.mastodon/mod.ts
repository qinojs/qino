// Public API of social.mastodon. The qino plugin lives in ./plugin.ts.
import { safeFetch } from "@qino/qino";
import { ProviderError } from "@qino/qino/social";

import { postOf } from "./lib/status.ts";

import type { App } from "@qino/qino";
import type { Provider, Target } from "@qino/qino/social";

// deno-lint-ignore no-explicit-any
type Account = any;

async function config(app: App): Promise<{ base: URL; token: string }> {
  const url = String(await app.settings["social.mastodon"].url ?? "").trim();
  const token = String(await app.settings["social.mastodon"].accessToken ?? "").trim();
  if (!url || !token) throw new ProviderError("social.mastodon: configure url and accessToken");
  const base = new URL(url);
  if (base.protocol !== "https:") throw new ProviderError("social.mastodon: url must use HTTPS");
  if (base.username || base.password) throw new ProviderError("social.mastodon: url must not contain credentials");
  base.pathname = "/";
  base.search = base.hash = "";
  return { base, token };
}

// deno-lint-ignore no-explicit-any
async function call(app: App, path: string, init: RequestInit = {}): Promise<any> {
  const { base, token } = await config(app);
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("authorization", `Bearer ${token}`);
  let res: Response;
  try { res = await safeFetch(new URL(path, base).href, { ...init, headers }, 0); }
  catch (e) { throw new ProviderError(`social.mastodon: ${(e as Error).message}`); }
  const data = await res.json().catch(() => ({}));
  if (res.ok) return data;
  const message = String(data.error_description ?? data.error ?? `${res.status} ${res.statusText}`);
  const retry = res.status === 429 ? Number(res.headers.get("retry-after")) || 60 : res.status >= 500 ? 60 : undefined;
  throw new ProviderError(`social.mastodon: ${message}`, retry);
}

async function account(app: App): Promise<Account> {
  return call(app, "/api/v1/accounts/verify_credentials");
}

const targetId = (account: Account) => String(account.uri ?? account.url ?? account.acct ?? account.id);

/** The account belonging to the configured Mastodon user token. */
async function targets(app: App): Promise<Omit<Target, "provider">[]> {
  const url = String(await app.settings["social.mastodon"].url ?? "").trim();
  const token = String(await app.settings["social.mastodon"].accessToken ?? "").trim();
  if (!url && !token) return [];
  const [cfg, user] = await Promise.all([config(app), account(app)]);
  return [{
    id: targetId(user),
    label: String(user.display_name ?? user.acct ?? user.username ?? user.id),
    url: String(user.url ?? cfg.base.origin),
  }];
}

export const socialProvider: Provider = {
  name: "mastodon",
  targets,
  async publish(app, target, text, key) {
    if (!text) throw new Error("social.mastodon: text is empty");
    const user = await account(app);
    if (target !== targetId(user)) throw new Error(`social.mastodon: unknown target ${target}`);
    const body = new URLSearchParams({ status: text });
    const status = await call(app, "/api/v1/statuses", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "idempotency-key": key },
      body,
    });
    status.source ??= { text };
    return postOf(target, status, String(user.id));
  },
  async sync(app, target) {
    const user = await account(app);
    if (target !== targetId(user)) throw new Error(`social.mastodon: unknown target ${target}`);
    const [own, notifications] = await Promise.all([
      call(app, `/api/v1/accounts/${encodeURIComponent(user.id)}/statuses?limit=40&exclude_reblogs=true`),
      call(app, "/api/v1/notifications?types%5B%5D=mention&limit=40"),
    ]);
    const mentioned = notifications.flatMap((notification: { status?: unknown }) => notification.status ? [notification.status] : []);
    return [...own, ...mentioned].map((status) => postOf(target, status, String(user.id)));
  },
};
