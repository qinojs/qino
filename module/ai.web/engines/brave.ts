// deno-lint-ignore-file no-explicit-any
import type { Engine } from "../mod.ts";

// https://api-dashboard.search.brave.com/app/documentation/web-search — $5 per 1,000 searches (2026)

/** Brave answers at most this many at once. */
const MAX = 20;

export const brave: Engine = async (key, query, count) => {
  const params = new URLSearchParams({ q: query, count: String(Math.min(count, MAX)), text_decorations: "false" });
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
    headers: { accept: "application/json", "x-subscription-token": key },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Brave: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()).web?.results ?? []).map((r: any) => ({ title: r.title, url: r.url, snippet: r.description ?? "" }));
};
