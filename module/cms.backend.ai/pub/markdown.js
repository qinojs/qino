// Markdown to sanitized HTML. marked and DOMPurify (~90 KB) load on first use; the page allows them
// in its CSP (`allowMarkdown()` of mod.ts).
let libs;

/** `text` as sanitized HTML. */
export async function markdown(text) {
  const [{ marked }, { default: DOMPurify }] = await (libs ??= Promise.all([
    import("https://cdn.jsdelivr.net/npm/marked@18/+esm"),
    import("https://cdn.jsdelivr.net/npm/dompurify@3/+esm"),
  ]));
  return DOMPurify.sanitize(marked.parse(text));
}
