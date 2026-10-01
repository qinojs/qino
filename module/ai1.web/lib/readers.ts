// deno-lint-ignore-file no-explicit-any
import { errMsg, fs, safeFetch, unhee } from "@qino/qino";

import type { Reader } from "../mod.ts";

// Who reads a page into Markdown. A reader service renders scripts and reads PDFs, and the page is
// fetched from its network, not ours; our own fetch costs nothing and tells nobody.

const TIMEOUT = 60_000;
/** A page larger than this is not read. */
const MAX_SIZE = 5 * 1024 * 1024;
const fail = (who: string, res: Response) => res.text().then((text) => { throw new Error(`${who}: HTTP ${res.status} ${text.slice(0, 200)}`); });

/** https://jina.ai/reader — with the key of api.jina.ai. */
export const jina: Reader = async (_app, url, key) => {
  const res = await fetch(`https://r.jina.ai/${url}`, {
    headers: { accept: "application/json", authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) return fail("Jina", res);
  const { data } = await res.json();
  return { title: data?.title ?? "", content: data?.content ?? "" };
};

/** https://firecrawl.dev — the main content only. */
export const firecrawl: Reader = async (_app, url, key) => {
  const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) return fail("Firecrawl", res);
  const { data } = await res.json();
  return { title: data?.metadata?.title ?? "", content: data?.markdown ?? "" };
};

/** Our own fetch, never into our own network (safeFetch). Text as it is; HTML, PDF and documents to
 *  Markdown by the transform pipeline (Pandoc, pdftotext). Scripts are not run. */
export const own: Reader = async (app, url) => {
  const res = await safeFetch(url, { headers: { accept: "text/html, text/markdown;q=0.9, text/plain;q=0.8, */*;q=0.5" } });
  if (!res.ok) return fail("fetch", res);
  if (Number(res.headers.get("content-length")) > MAX_SIZE) throw new Error(`fetch: larger than ${MAX_SIZE} bytes`);
  const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_SIZE) throw new Error(`fetch: larger than ${MAX_SIZE} bytes`);
  const text = new TextDecoder().decode(bytes);
  if (mime.startsWith("text/") && mime !== "text/html") return { title: "", content: text };
  const title = mime === "text/html" ? unhee(/<title[^>]*>([^<]*)/i.exec(text)?.[1].trim() ?? "") : "";
  const dir = app.modules.get("ai1.web")!.tmp, path = `${dir}${crypto.randomUUID()}`;
  await fs.mkdir(dir);
  await fs.write(path, bytes);
  try {
    const result = await app.fileTransformer.transform(path, { fmt: "md" }, mime);
    if (!result.transformed) throw new Error(`fetch: cannot read ${mime || "it"}${result.error ? `: ${errMsg(result.error)}` : ""}`);
    return { title, content: await fs.text(result.path) };
  } finally {
    await fs.remove(path).catch(() => {});
  }
};
