// Public API of social.threads. The qino plugin lives in ./plugin.ts.
import { errMsg, safeFetch, unixTime } from "@qino/qino";
import { ProviderError } from "@qino/qino/social";

import type { App } from "@qino/qino";
import type { Provider, Target } from "@qino/qino/social";

const BASE = new URL("https://graph.threads.net/v1.0/");

// deno-lint-ignore no-explicit-any
async function call(app: App, path: string, init: RequestInit = {}): Promise<any> {
  const token = String(await app.settings["social.threads"].accessToken ?? "").trim();
  if (!token) throw new Error("social.threads: configure accessToken");
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("authorization", `Bearer ${token}`);
  let res: Response;
  try { res = await safeFetch(new URL(path, BASE).href, { ...init, headers }, 0); }
  catch (e) { throw new Error(`social.threads: ${errMsg(e)}`); }
  const data = await res.json().catch(() => ({}));
  if (res.ok) return data;
  const message = String(data.error?.message ?? data.error?.type ?? `${res.status} ${res.statusText}`);
  if (res.status === 429) throw new ProviderError(`social.threads: ${message}`, Number(res.headers.get("retry-after")) || 60);
  throw new Error(`social.threads: ${message}`);
}

// deno-lint-ignore no-explicit-any
async function account(app: App): Promise<any> {
  return call(app, "me?fields=id,username,name");
}

async function targets(app: App): Promise<Omit<Target, "provider">[]> {
  if (!String(await app.settings["social.threads"].accessToken ?? "").trim()) return [];
  const user = await account(app);
  const username = String(user.username ?? "");
  return [{
    id: String(user.id),
    label: String(user.name ?? (username || user.id)),
    ...(username ? { url: `https://www.threads.net/@${username}` } : {}),
  }];
}

export const socialProvider: Provider = {
  name: "threads",
  targets,
  async publish(app, target, text) {
    if (!text) throw new Error("social.threads: text is empty");
    const user = await account(app);
    if (target !== String(user.id)) throw new Error(`social.threads: unknown target ${target}`);
    const body = new URLSearchParams({ media_type: "TEXT", text, auto_publish_text: "true" });
    const post = await call(app, `${encodeURIComponent(target)}/threads`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    return {
      target,
      id: String(post.id),
      text,
      own: true,
      authorId: target,
      authorName: String(user.name ?? user.username ?? "") || undefined,
      time: unixTime(),
    };
  },
};
