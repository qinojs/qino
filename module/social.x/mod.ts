// Public API of social.x. The qino plugin lives in ./plugin.ts.
import { errMsg, safeFetch, unixTime } from "@qino/qino";
import { ProviderError } from "@qino/qino/social";

import { postOf } from "./lib/post.ts";

import type { App } from "@qino/qino";
import type { Post, Provider, Target } from "@qino/qino/social";

// deno-lint-ignore no-explicit-any
type User = any;

class XError extends Error {
  status: number;
  retryAfter: number | undefined;
  constructor(message: string, status = 0, retryAfter?: number) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

// deno-lint-ignore no-explicit-any
async function call(app: App, path: string, init: RequestInit = {}): Promise<any> {
  const token = String(await app.settings["social.x"].accessToken ?? "").trim();
  if (!token) throw new XError("social.x: configure accessToken");
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("authorization", `Bearer ${token}`);
  let res: Response;
  try { res = await safeFetch(`https://api.x.com${path}`, { ...init, headers }, 0); }
  catch (e) { throw new XError(`social.x: ${errMsg(e)}`); }
  const data = await res.json().catch(() => ({}));
  if (res.ok) return data;
  const message = String(data.detail ?? data.title ?? data.errors?.[0]?.message ?? `${res.status} ${res.statusText}`);
  const retryAfter = res.status === 429 ? Number(res.headers.get("retry-after")) || 60 : undefined;
  throw new XError(`social.x: ${message}`, res.status, retryAfter);
}

async function account(app: App): Promise<User> {
  return (await call(app, "/2/users/me")).data;
}

async function targets(app: App): Promise<Omit<Target, "provider">[]> {
  if (!String(await app.settings["social.x"].accessToken ?? "").trim()) return [];
  const user = await account(app);
  return [{ id: String(user.id), label: String(user.name ?? user.username ?? user.id), url: `https://x.com/${user.username}` }];
}

// deno-lint-ignore no-explicit-any
function postsOf(target: string, response: any): Post[] {
  const users = new Map<string, User>((response.includes?.users ?? []).map((user: User) => [String(user.id), user]));
  return (response.data ?? []).map((post: unknown) => postOf(target, post, users));
}

const timeline = (id: string, kind = "tweets") =>
  `/2/users/${encodeURIComponent(id)}/${kind}?max_results=40&tweet.fields=author_id,created_at,referenced_tweets&expansions=author_id&user.fields=name,username`;

export const socialProvider: Provider = {
  name: "x",
  targets,
  async publish(app, target, text) {
    if (!text) throw new Error("social.x: text is empty");
    const user = await account(app);
    if (target !== String(user.id)) throw new Error(`social.x: unknown target ${target}`);
    let response;
    try {
      response = await call(app, "/2/tweets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
    } catch (e) {
      if (e instanceof XError && e.status === 429) throw new ProviderError(e.message, e.retryAfter);
      throw e;
    }
    const post = response.data;
    return {
      target,
      id: String(post.id),
      text: String(post.text ?? text),
      own: true,
      url: `https://x.com/${user.username}/status/${post.id}`,
      authorId: String(user.id),
      authorName: String(user.name ?? user.username ?? "") || undefined,
      time: unixTime(),
    };
  },
  async sync(app, target) {
    const user = await account(app);
    if (target !== String(user.id)) throw new Error(`social.x: unknown target ${target}`);
    const [own, mentions] = await Promise.all([
      call(app, timeline(target)),
      call(app, timeline(target, "mentions")),
    ]);
    return [...postsOf(target, own), ...postsOf(target, mentions)];
  },
};
