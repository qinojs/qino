import { fetchJson } from "@qino/qino/social";

import { postOf } from "./lib/status.ts";

import type { App } from "@qino/qino";
import type { Provider } from "@qino/qino/social";

// deno-lint-ignore no-explicit-any
type Account = any;
const ACCOUNT = "/api/v1/accounts/verify_credentials";

async function config(app: App) {
  const settings = app.settings["social.mastodon"];
  const url = String(await settings.url ?? "").trim();
  const token = String(await settings.accessToken ?? "").trim();
  if (!url || !token) throw new Error("social.mastodon: configure url and accessToken");
  const base = new URL(url);
  if (base.protocol !== "https:") throw new Error("social.mastodon: url must use HTTPS");
  if (base.username || base.password) throw new Error("social.mastodon: url must not contain credentials");
  base.pathname = "/";
  base.search = base.hash = "";
  return { base, token };
}

async function call(app: App, path: string, init: RequestInit = {}) {
  const { base, token } = await config(app);
  return fetchJson("social.mastodon", new URL(path, base).href,
    { ...init, token, error: (data) => data.error_description ?? data.error });
}

const targetId = (account: Account) => String(account.uri ?? account.url ?? account.acct ?? account.id);

/** The account belonging to the configured Mastodon user token. */
async function targets(app: App) {
  const settings = app.settings["social.mastodon"];
  const url = String(await settings.url ?? "").trim();
  const token = String(await settings.accessToken ?? "").trim();
  if (!url && !token) return [];
  const [cfg, user] = await Promise.all([config(app), call(app, ACCOUNT)]);
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
    const user = await call(app, ACCOUNT);
    if (target !== targetId(user)) throw new Error(`social.mastodon: unknown target ${target}`);
    const body = new URLSearchParams({ status: text, visibility: "public" });
    const status = await call(app, "/api/v1/statuses", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "idempotency-key": key },
      body,
    });
    status.source ??= { text };
    return postOf(target, status, String(user.id));
  },
  async sync(app, target) {
    const user = await call(app, ACCOUNT);
    if (target !== targetId(user)) throw new Error(`social.mastodon: unknown target ${target}`);
    const [own, notifications] = await Promise.all([
      call(app, `/api/v1/accounts/${encodeURIComponent(user.id)}/statuses?limit=40&exclude_reblogs=true`),
      call(app, "/api/v1/notifications?types%5B%5D=mention&limit=40"),
    ]);
    const mentioned = notifications.map((notification: { status?: unknown }) => notification.status).filter(Boolean);
    return [...own, ...mentioned].map((status) => postOf(target, status, String(user.id)));
  },
};
