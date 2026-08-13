import { assert, assertEquals } from "@qino/qino/tests";

import { Provider } from "../lib/Provider.ts";

const row = { id: 1, name: "test", endpoint: "https://x", timeout_ms: 1000 };

Deno.test("Provider: retries on 429 then returns the JSON body", async () => {
  const orig = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (() => {
    calls++;
    if (calls === 1) return Promise.resolve(new Response("rate", { status: 429, headers: { "retry-after": "0" } }));
    return Promise.resolve(new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } }));
  }) as never;
  try {
    const res = await new Provider(row, "key").json("/chat/completions", { a: 1 });
    assertEquals(res, { ok: true });
    assertEquals(calls, 2);
  } finally {
    globalThis.fetch = orig;
  }
});

Deno.test("Provider: timeout surfaces as an error object", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new DOMException("aborted", "TimeoutError"))) as never;
  try {
    const res = await new Provider(row, "key").json("/x", {}) as { error: string };
    assert(res.error.includes("timed out"));
  } finally {
    globalThis.fetch = orig;
  }
});
