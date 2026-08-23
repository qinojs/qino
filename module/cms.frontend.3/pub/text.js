import { addStyle } from "./shell.js";

const tags = new Set("H1 H2 H3 H4 H5 H6 A BR HR P B STRONG EM I IMG DIV TABLE TR TD TH TBODY THEAD SPAN LI UL OL".split(" "));
const remove = new Set("SCRIPT STYLE META LINK TITLE IFRAME OBJECT EMBED".split(" "));
const attributes = new Set("src target href alt title colspan rowspan".split(" "));
const safeUrl = value => {
  value = value.replace(/[\s\u0000-\u001f]/g, "");
  return !/^[a-z][\w+.-]*:/i.test(value) || /^(https?|mailto|tel|cmspid):/i.test(value);
};
const clean = node => {
  for (const child of [...node.childNodes]) clean(child);
  if (node.nodeType === Node.COMMENT_NODE) return node.remove();
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  if (remove.has(node.tagName)) return node.remove();
  if (!tags.has(node.tagName)) return node.replaceWith(...node.childNodes);
  for (const attr of [...node.attributes]) {
    if (!attributes.has(attr.name) || ["href", "src"].includes(attr.name) && !safeUrl(attr.value.trim())) node.removeAttribute(attr.name);
  }
};
globalThis.onPasteFormatNode = node => {
  for (const child of [...node.childNodes]) clean(child);
};

const paste = event => {
  const el = event.target.closest?.("[cmstxt][contenteditable]");
  const html = el && event.clipboardData?.getData("text/html");
  if (!html) return;
  const range = getSelection().getRangeAt(0);
  const template = document.createElement("template");
  template.innerHTML = html;
  globalThis.onPasteFormatNode(template.content);
  range.deleteContents();
  range.insertNode(template.content);
  range.collapse(false);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  event.preventDefault();
};

export async function initText(root) {
  addStyle(root, import.meta.resolve("@qino/pub/Rte/main.css"));
  await import("@qino/pub/Rte/index.mjs");
  Rte.on("activate", () => root.append(Rte.ui.div));
  document.addEventListener("paste", paste);
}
