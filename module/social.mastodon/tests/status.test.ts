import { assertEquals } from "@std/assert";

import { postOf } from "../lib/status.ts";

Deno.test("social.mastodon normalizes own and remote statuses to plain posts", () => {
  assertEquals(postOf("https://social.test#7", {
    id: "10",
    created_at: "2026-08-26T10:00:00Z",
    in_reply_to_id: null,
    content: "<p>Hello <strong>world</strong></p>",
    url: "https://social.test/@qino/10",
    uri: "https://social.test/users/qino/statuses/10",
    visibility: "public",
    account: { id: "7", acct: "qino" },
  }, "7"), {
    target: "https://social.test#7",
    id: "10",
    parentId: undefined,
    own: true,
    text: "Hello world",
    url: "https://social.test/@qino/10",
    authorId: "7",
    authorName: "qino",
    time: 1787738400,
  });
});
