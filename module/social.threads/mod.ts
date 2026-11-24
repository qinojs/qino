import { unixTime } from "@qino/qino";
import { fetchJson } from "@qino/qino/social";

import type { App } from "@qino/qino";
import type { Provider } from "@qino/qino/social";

const BASE = new URL("https://graph.threads.net/v1.0/");
const ACCOUNT = "me?fields=id,username,name";

async function call(app: App, path: string, init: RequestInit = {}) {
  const token = String(await app.settings["social.threads"].accessToken ?? "").trim();
  if (!token) throw new Error("social.threads: configure accessToken");
  return fetchJson("social.threads", new URL(path, BASE).href,
    { ...init, token, error: (data) => data.error?.message ?? data.error?.type });
}

async function targets(app: App) {
  if (!String(await app.settings["social.threads"].accessToken ?? "").trim()) return [];
  const user = await call(app, ACCOUNT);
  const username = String(user.username ?? "");
  return [{
    id: String(user.id),
    label: String(user.name ?? (username || user.id)),
    ...(username && { url: `https://www.threads.net/@${username}` }),
  }];
}

export const socialProvider: Provider = {
  name: "threads",
  targets,
  async publish(app, target, text) {
    if (!text) throw new Error("social.threads: text is empty");
    const user = await call(app, ACCOUNT);
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
