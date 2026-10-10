import { getCtx } from "@qino/qino";

/** What pub/markdown.js loads. */
const LIBS = ["https://cdn.jsdelivr.net/npm/marked@18/+esm", "https://cdn.jsdelivr.net/npm/dompurify@3/+esm"];

/** Let the page load what pub/markdown.js renders with. */
export function allowMarkdown(): void {
  for (const url of LIBS) getCtx().res.csp["script-src"][url] = true;
}
