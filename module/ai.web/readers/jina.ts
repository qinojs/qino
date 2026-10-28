import type { Reader } from "../mod.ts";

// https://jina.ai/reader — renders scripts, reads PDFs, fetches from its own network.

export const jina: Reader = async (_app, url, key) => {
  const res = await fetch(`https://r.jina.ai/${url}`, {
    headers: { accept: "application/json", authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Jina: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const { data } = await res.json();
  return { title: data?.title ?? "", content: data?.content ?? "" };
};
