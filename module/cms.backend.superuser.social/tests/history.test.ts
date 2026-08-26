import { assertStringIncludes, fakeT } from "@qino/qino/tests";

import { history } from "../plugin.ts";

Deno.test("social backend groups Qino posts and shows every linked provider", async () => {
  const rows = [
    { id: 3, log_id: 2, provider: "bluesky", text: "Later", sent: null, error: null },
    { id: 2, log_id: 1, provider: "bluesky", text: "Hello", sent: null, error: "Invalid record" },
    { id: 1, log_id: 1, provider: "mastodon", text: "Hello", sent: 10, error: null, url: "https://mastodon.test/1" },
  ];
  const app = {
    db: { col: () => Promise.resolve([2, 1]), query: () => Promise.resolve(rows) },
    modules: { linked: () => ["mastodon", "bluesky", "threads"].map((name) => ({ plugin: { socialProvider: { name } } })) },
    t: fakeT,
  } as never;
  const output = String(await history(app));
  assertStringIncludes(output, "<th>Mastodon");
  assertStringIncludes(output, "<th>Bluesky");
  assertStringIncludes(output, "<th>Threads");
  assertStringIncludes(output, "Hello");
  assertStringIncludes(output, "Invalid record");
  assertStringIncludes(output, "Not sent");
  assertStringIncludes(output, "https://mastodon.test/1");
});
