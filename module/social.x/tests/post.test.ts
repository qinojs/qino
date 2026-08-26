import { assertEquals } from "@std/assert";

import { postOf } from "../lib/post.ts";

Deno.test("social.x normalizes replies and authors", () => {
  const users = new Map([["2", { id: "2", name: "Ada", username: "ada" }]]);
  const post = postOf("1", {
    id: "9",
    text: "Hello",
    author_id: "2",
    created_at: "2026-01-02T03:04:05Z",
    referenced_tweets: [{ type: "replied_to", id: "8" }],
  }, users);
  assertEquals({ ...post, time: 0 }, {
    target: "1",
    id: "9",
    text: "Hello",
    parentId: "8",
    own: false,
    url: "https://x.com/ada/status/9",
    authorId: "2",
    authorName: "Ada",
    time: 0,
  });
});
