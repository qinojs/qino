import { errMsg, fs, safeFetch } from "@qino/qino";
import { Parser } from "htmlparser2";

import type { Reader } from "../mod.ts";

// Our own fetch: costs nothing and tells nobody, never reaches our own network (safeFetch). Text as it
// is; HTML, PDF and documents to Markdown by the transform pipeline (Pandoc, pdftotext). Scripts are
// not run.

/** A page larger than this is not read. */
const MAX_SIZE = 5 * 1024 * 1024;

/** The page's <title>, its entities decoded (&auml; is ä). */
function titleOf(html: string) {
  let title = "", within = false;
  new Parser({
    onopentag: (name) => within = name === "title",
    ontext: (text) => within && (title += text),
    onclosetag: () => within = false,
  }, { decodeEntities: true }).end(html);
  return title.trim();
}

export const own: Reader = async (app, url) => {
  const res = await safeFetch(url, { headers: { accept: "text/html, text/markdown;q=0.9, text/plain;q=0.8, */*;q=0.5" } });
  if (!res.ok) throw new Error(`fetch: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  if (Number(res.headers.get("content-length")) > MAX_SIZE) throw new Error(`fetch: larger than ${MAX_SIZE} bytes`);
  const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_SIZE) throw new Error(`fetch: larger than ${MAX_SIZE} bytes`);
  const text = new TextDecoder().decode(bytes);
  if (mime.startsWith("text/") && mime !== "text/html") return { title: "", content: text };
  const title = mime === "text/html" ? titleOf(text) : "";
  const dir = app.modules.get("ai.web")!.tmp, path = `${dir}${crypto.randomUUID()}`;
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
