import { unixTime } from "@qino/qino";
import { fetchJson } from "@qino/qino/social";

import { tid } from "./lib/tid.ts";

import type { App } from "@qino/qino";
import type { Provider } from "@qino/qino/social";

// deno-lint-ignore no-explicit-any
type Session = any;

async function config(app: App) {
  const settings = app.settings["social.bluesky"];
  const url = String(await settings.url ?? "https://bsky.social").trim();
  const handle = String(await settings.handle ?? "").trim();
  const password = String(await settings.appPassword ?? "").trim();
  if (!handle || !password) throw new Error("social.bluesky: configure handle and appPassword");
  const base = new URL(url);
  if (base.protocol !== "https:") throw new Error("social.bluesky: url must use HTTPS");
  if (base.username || base.password) throw new Error("social.bluesky: url must not contain credentials");
  base.pathname = "/";
  base.search = base.hash = "";
  return { base, handle, password };
}

const call = (base: URL, path: string, init: RequestInit = {}) =>
  fetchJson("social.bluesky", new URL(path, base).href, { ...init, error: (data) => data.message ?? data.error });

async function session(app: App) {
  const { base, handle, password } = await config(app);
  const user = await call(base, "/xrpc/com.atproto.server.createSession", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: handle, password }),
  });
  return { base, user };
}

const labelOf = (user: Session) => String(user.handle ?? user.did);
const profileUrl = (did: string, post?: string) =>
  `https://bsky.app/profile/${encodeURIComponent(did).replaceAll("%3A", ":")}${post ? `/post/${encodeURIComponent(post)}` : ""}`;

async function targets(app: App) {
  const settings = app.settings["social.bluesky"];
  if (!String(await settings.handle ?? "").trim() && !String(await settings.appPassword ?? "").trim()) return [];
  const { user } = await session(app), id = String(user.did);
  return [{ id, label: labelOf(user), url: profileUrl(id) }];
}

export const socialProvider: Provider = {
  name: "bluesky",
  targets,
  async publish(app, target, text, key) {
    if (!text) throw new Error("social.bluesky: text is empty");
    const { base, user } = await session(app), did = String(user.did);
    if (target !== did) throw new Error(`social.bluesky: unknown target ${target}`);
    const rkey = await tid(key);
    const createdAt = new Date().toISOString();
    const response = await call(base, "/xrpc/com.atproto.repo.putRecord", {
      method: "POST",
      headers: { "authorization": `Bearer ${user.accessJwt}`, "content-type": "application/json" },
      body: JSON.stringify({
        repo: user.did,
        collection: "app.bsky.feed.post",
        rkey,
        record: { $type: "app.bsky.feed.post", text, createdAt },
      }),
    });
    const id = String(response.uri ?? "").split("/").pop() || rkey;
    return {
      target,
      id,
      text,
      own: true,
      url: profileUrl(did, id),
      authorId: did,
      authorName: labelOf(user),
      time: unixTime(),
    };
  },
};
