import { unixTime } from "@qino/qino";
import { htmlToText } from "@qino/qino/messaging";

import type { Post } from "@qino/qino/social";

// deno-lint-ignore no-explicit-any
export function postOf(target: string, status: any, accountId: string): Post {
  const own = String(status.account?.id ?? "") === accountId;
  const parentId = status.in_reply_to_id == null ? undefined : String(status.in_reply_to_id);
  const created = Date.parse(String(status.created_at ?? ""));
  return {
    target,
    id: String(status.id),
    parentId,
    own,
    text: String(status.source?.text ?? "") || htmlToText(String(status.content ?? "")),
    url: String(status.url ?? status.uri ?? "") || undefined,
    authorId: status.account?.id == null ? undefined : String(status.account.id),
    authorName: String(status.account?.display_name ?? status.account?.acct ?? "") || undefined,
    time: Number.isFinite(created) ? Math.floor(created / 1000) : unixTime(),
  };
}
