import type { Node } from "@qino/qino/cms";
import { hee } from "@qino/qino";
import { cms_image2 } from "@qino/qino/cms.image2";
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
  const linkTarget = attrValue(el, "cms-link");
  if (linkTarget) return renderCmsLink(el, linkTarget, node);
  const textName = attrValue(el, "cms-text");
  if (textName) return renderCmsText(el, textName, node);
  for (const a of el.attrs) {
    if (!a.name.startsWith("cms-")) continue;
    warn(node, a.name === "cms-text" || a.name === "cms-link" ? `${a.name} without value on <${el.tag}>` : `unknown attribute ${a.name} on <${el.tag}>`);
  }
  return tagHtml(el, el.self ? "" : await renderNodes(el.children, node));
}

/** Typos in templates must be visible: warn in dev and edit mode */
function warn(node: Node, msg: string): void {
  if (node.app.dev || node.edit) console.warn(`templateParser: ${msg} (module ${node.module?.name})`);
}

/** Resolve node= — a node id, "page", "parent"/"parent(2)" or "layout" (default: current node) */
async function targetNode(el: El, node: Node): Promise<Node | undefined> {
  const spec = attrValue(el, "node");
  if (spec === undefined) return node;
  const target = await resolveNodeSpec(spec, node);
  if (!target) warn(node, `unresolvable node="${spec}" on <${el.tag}>`);
  return target;
}

async function resolveNodeSpec(spec: string, node: Node): Promise<Node | undefined> {
  if (/^\d+$/.test(spec)) return (await node.cms.node(Number(spec))).exists();
  if (spec === "page")    return node.page();
  if (spec === "layout") {
    const module = (await node.page()).module?.name;
    return module ? node.cms.layoutPage(module) : undefined;
  }
  const m = spec.match(/^parent(?:\((\d+)\))?$/);
  if (m) return node.parent(m[1] ? Number(m[1]) : undefined);
}

// ---------------------------------------------------------------------------
// cms-link — stable internal href resolved from a node
// ---------------------------------------------------------------------------

async function renderCmsLink(el: El, spec: string, node: Node): Promise<string> {
  const target = await resolveNodeSpec(spec, node);
  if (!target) {
    warn(node, `unresolvable cms-link="${spec}" on <${el.tag}>`);
    return renderElement({ ...el, attrs: el.attrs.filter(a => a.name !== "cms-link") }, node);
  }
  const linkAttrs = await target.cms.linkAttributes(target);
  const attrs = el.attrs.filter(a => !["cms-link", "href", "class"].includes(a.name));
  const templateTarget = attrValue(el, "target");
  if (templateTarget !== undefined) delete linkAttrs.target;
  const className = attrValue(el, "class");
  if (className) linkAttrs.class = `${className} ${linkAttrs.class}`;
  for (const [name, value] of Object.entries(linkAttrs)) attrs.push({ name, value });
  const empty = !hasAttr(el, "cms-text") && el.children.every(n => n.type === "text" && !n.value.trim());
  const children = empty ? [{ type: "text" as const, value: String(await target.showTitle()) }] : el.children;
  return renderElement({ ...el, attrs, children }, node);
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
  const target = await targetNode(el, node);
  if (!target) return "";
  const options: Record<string, unknown> = { tag: el.tag };
  for (const a of el.attrs) {
    if (a.name === "cms-text" || a.name === "node") continue;
    options[a.name] = a.value ?? true;
  }
  const initial = serialize(el.children).trim();
  if (initial) options.initial = initial;
  return String(await target.cms.text(target, name, options));
}

// ---------------------------------------------------------------------------
// <cms-image name=... /> — rendered via cms.image2, attributes become options
// ---------------------------------------------------------------------------

async function renderCmsImage(el: El, node: Node): Promise<string> {
  const name = attrValue(el, "name");
  if (!name) { warn(node, "<cms-image> without name"); return ""; }
  const target = await targetNode(el, node);
  if (!target) return "";
  const file = hasAttr(el, "localized") ? await target.cms.fileLang(target, name) : await target.file(name);
  if (!file) return "";
  const opts: Record<string, unknown> = { if: 1 };
  if (target.edit) opts.editable = await file.url();
  for (const a of el.attrs) {
    if (a.name === "name" || a.name === "localized" || a.name === "node") continue;
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
  const target = await targetNode(el, node);
  if (!target) return "";
  const module = attrValue(el, "module") ?? attrValue(el, "default-module") ?? "cms.cont.flexible";
  return String(await (await target.cont(name, module)).html());
}
