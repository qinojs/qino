import type { Reader } from "../mod.ts";

// https://firecrawl.dev — renders scripts, the main content only.

export const firecrawl: Reader = async (_app, url, key) => {
  const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Firecrawl: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const { data } = await res.json();
  return { title: data?.metadata?.title ?? "", content: data?.markdown ?? "" };
};
