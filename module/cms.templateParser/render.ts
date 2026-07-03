import type { Node } from "../cms/mod.ts";
import { hee } from "../core/mod.ts";
import { cms_image2 } from "../cms.image2/mod.ts";
import { VOID, type TNode, type TAttr } from "./parse.ts";

type El = Extract<TNode, { type: "element" }>;

export async function renderNodes(nodes: TNode[], node: Node): Promise<string> {
  let out = "";
  for (const n of nodes) out += n.type === "text" ? n.value : await renderElement(n, node);
  return out;
}

async function renderElement(el: El, node: Node): Promise<string> {
  if (el.tag === "cms-image") return renderCmsImage(el, node);
  if (el.tag === "cms-cont")  return renderCmsCont(el, node);
  if (el.tag.startsWith("cms-")) warn(node, `unknown element <${el.tag}>`);
  const textName = attrValue(el, "cms-text");
  if (textName) return renderCmsText(el, textName, node);
  for (const a of el.attrs) {
    if (!a.name.startsWith("cms-")) continue;
    warn(node, a.name === "cms-text" ? `cms-text without value on <${el.tag}>` : `unknown attribute ${a.name} on <${el.tag}>`);
  }
  return tagHtml(el, el.self ? "" : await renderNodes(el.children, node));
}

/** Typos in templates must be visible: warn in dev and edit mode */
function warn(node: Node, msg: string): void {
  if (node.app.dev || node.edit) console.warn(`templateParser: ${msg} (module ${node.module?.name})`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function attrValue(el: El, name: string): string | undefined {
  const a = el.attrs.find(a => a.name === name);
  return a ? a.value ?? "" : undefined;
}

const hasAttr = (el: El, name: string) => el.attrs.some(a => a.name === name);

function attrsHtml(attrs: TAttr[]): string {
  let out = "";
  for (const a of attrs) out += a.value === null ? ` ${a.name}` : ` ${a.name}="${hee(a.value)}"`;
  return out;
}

function tagHtml(el: El, inner: string): string {
  if (el.self && VOID.has(el.tag)) return `<${el.tag}${attrsHtml(el.attrs)}>`;
  return `<${el.tag}${attrsHtml(el.attrs)}>${inner}</${el.tag}>`;
}

/** Static subtree back to HTML (cms-text initial content) */
function serialize(nodes: TNode[]): string {
  let out = "";
  for (const n of nodes) out += n.type === "text" ? n.value : tagHtml(n, serialize(n.children));
  return out;
}

// ---------------------------------------------------------------------------
// cms-text — the tag becomes the wrapper, inner html is the initial content
// ---------------------------------------------------------------------------

async function renderCmsText(el: El, name: string, node: Node): Promise<string> {
  const options: Record<string, unknown> = { tag: el.tag };
  for (const a of el.attrs) {
    if (a.name === "cms-text") continue;
    options[a.name] = a.value ?? true;
  }
  const initial = serialize(el.children).trim();
  if (initial) options.initial = initial;
  return String(await node.cms.text(node, name, options));
}

// ---------------------------------------------------------------------------
// <cms-image name=... /> — rendered via cms.image2, attributes become options
// ---------------------------------------------------------------------------

async function renderCmsImage(el: El, node: Node): Promise<string> {
  const name = attrValue(el, "name");
  if (!name) { warn(node, "<cms-image> without name"); return ""; }
  const file = hasAttr(el, "localized") ? await node.cms.fileLang(node, name) : await node.file(name);
  if (!file) return "";
  const opts: Record<string, unknown> = { if: 1 };
  if (node.edit) opts.editable = await file.url();
  for (const a of el.attrs) {
    if (a.name === "name" || a.name === "localized") continue;
    opts[a.name] = a.value ?? true;
  }
  if (opts.width)  opts.width  = Number(opts.width)  || opts.width;
  if (opts.height) opts.height = Number(opts.height) || opts.height;
  return String(await cms_image2(file, opts));
}

// ---------------------------------------------------------------------------
// <cms-cont name=... /> — embedded sub-content node
// ---------------------------------------------------------------------------

async function renderCmsCont(el: El, node: Node): Promise<string> {
  const name = attrValue(el, "name");
  if (!name) { warn(node, "<cms-cont> without name"); return ""; }
  const module = attrValue(el, "module") ?? attrValue(el, "default-module") ?? "cms.cont.flexible";
  return String(await (await node.cont(name, module)).html());
}
