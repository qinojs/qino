import { unixTime } from "@qino/qino";

import type { Post } from "@qino/qino/social";

// deno-lint-ignore no-explicit-any
export function postOf(target: string, post: any, users: Map<string, any>): Post {
  const author = users.get(String(post.author_id ?? "")) ?? {};
  const parent = post.referenced_tweets?.find((item: { type?: string }) => item.type === "replied_to");
  const created = Date.parse(String(post.created_at ?? ""));
  return {
    target,
    id: String(post.id),
    text: String(post.text ?? ""),
    parentId: parent?.id == null ? undefined : String(parent.id),
    own: String(post.author_id ?? "") === target,
    url: author.username ? `https://x.com/${author.username}/status/${post.id}` : undefined,
    authorId: post.author_id == null ? undefined : String(post.author_id),
    authorName: String(author.name ?? author.username ?? "") || undefined,
    time: Number.isFinite(created) ? Math.floor(created / 1000) : unixTime(),
  };
}
