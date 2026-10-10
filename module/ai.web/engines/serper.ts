// deno-lint-ignore-file no-explicit-any
import type { Engine } from "../mod.ts";

// https://serper.dev — Google's results, $0.30 to $1 per 1,000 searches (2026)

/** Serper answers at most this many at once. */
const MAX = 100;

export const serper: Engine = async (key, query, count) => {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key },
    body: JSON.stringify({ q: query, num: Math.min(count, MAX) }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Serper: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()).organic ?? []).map((r: any) => ({ title: r.title, url: r.link, snippet: r.snippet ?? "" }));
};
