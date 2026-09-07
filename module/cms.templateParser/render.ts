import { fillPlaceholders, hee, modulePlaceholders, placeholderNames } from "@qino/qino";
import { cms_image2 } from "@qino/qino/cms.image2";

import { VOID } from "./parse.ts";

import type { TemplateValue } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { TNode, TAttr } from "./parse.ts";

type El = Extract<TNode, { type: "element" }>;

/** One template run: the node it renders for, and the placeholder values its text may name. */
class Tpl {
  node: Node;
  #values: Record<string, TemplateValue>;
  constructor(node: Node, values: Record<string, TemplateValue>) {
    this.node = node;
    this.#values = values;
  }
  /** As plain text — an attribute value, escaped by whoever writes it out. */
  text(source: string): string {
    return fillPlaceholders(source, (name) => this.#values[name]?.text);
  }
  /** In a text node: a module's trusted html form, otherwise its text, escaped. */
  html(source: string): string {
    return fillPlaceholders(source, (name) => String(this.#values[name]?.html ?? hee(this.#values[name]?.text ?? "")));
  }
}

export async function renderNodes(nodes: TNode[], node: Node): Promise<string> {
  return render(nodes, new Tpl(node, await templateValues(nodes, node)));
}

async function render(nodes: TNode[], t: Tpl): Promise<string> {
  let out = "";
  for (const n of nodes) out += n.type === "text" ? t.html(n.value) : await renderElement(n, t);
  return out;
}

async function renderElement(el: El, t: Tpl): Promise<string> {
  if (el.tag === "cms-image") return renderCmsImage(el, t);
  if (el.tag === "cms-cont")  return renderCmsCont(el, t);
  if (el.tag.startsWith("cms-")) await warn(t.node, `unknown element <${el.tag}>`);
  const linkTarget = attrValue(el, "cms-link", t);
  if (linkTarget) return renderCmsLink(el, linkTarget, t);
  const textName = attrValue(el, "cms-text", t);
  if (textName) return renderCmsText(el, textName, t);
  for (const a of el.attrs) {
    if (!a.name.startsWith("cms-")) continue;
    await warn(t.node, a.name === "cms-text" || a.name === "cms-link" ? `${a.name} without value on <${el.tag}>` : `unknown attribute ${a.name} on <${el.tag}>`);
  }
  return tagHtml(el, el.self ? "" : await render(el.children, t), t);
}

/** Typos in templates must be visible: warn in dev and edit mode */
async function warn(node: Node, msg: string): Promise<void> {
  if (node.app.dev || await node.edit()) console.warn(`templateParser: ${msg} (module ${node.module?.name})`);
}

/** Resolve node= — a node id, "page", "parent"/"parent(2)" or "layout" (default: current node) */
async function targetNode(el: El, t: Tpl): Promise<Node | undefined> {
  const spec = attrValue(el, "node", t);
  if (spec === undefined) return t.node;
  const target = await resolveNodeSpec(spec, t.node);
  if (!target) await warn(t.node, `unresolvable node="${spec}" on <${el.tag}>`);
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

async function renderCmsLink(el: El, spec: string, t: Tpl): Promise<string> {
  const target = await resolveNodeSpec(spec, t.node);
  if (!target) {
    await warn(t.node, `unresolvable cms-link="${spec}" on <${el.tag}>`);
    return renderElement({ ...el, attrs: el.attrs.filter(a => a.name !== "cms-link") }, t);
  }
  const linkAttrs = await target.cms.linkAttributes(target);
  const attrs = el.attrs.filter(a => !["cms-link", "href", "class"].includes(a.name));
  const templateTarget = attrValue(el, "target", t);
  if (templateTarget !== undefined) delete linkAttrs.target;
  const className = attrValue(el, "class", t);
  if (className) linkAttrs.class = `${className} ${linkAttrs.class}`;
  for (const [name, value] of Object.entries(linkAttrs)) attrs.push({ name, value });
  const empty = !hasAttr(el, "cms-text") && el.children.every(n => n.type === "text" && !n.value.trim());
  const children = empty ? [{ type: "text" as const, value: String(await target.showTitle()) }] : el.children;
  return renderElement({ ...el, attrs, children }, t);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function attrValue(el: El, name: string, t: Tpl): string | undefined {
  const a = el.attrs.find(a => a.name === name);
  return a ? t.text(a.value ?? "") : undefined;
}

const hasAttr = (el: El, name: string) => el.attrs.some(a => a.name === name);

function attrsHtml(attrs: TAttr[], t: Tpl): string {
  let out = "";
  for (const a of attrs) out += a.value === null ? ` ${a.name}` : ` ${a.name}="${hee(t.text(a.value))}"`;
  return out;
}

function tagHtml(el: El, inner: string, t: Tpl): string {
  if (el.self && VOID.has(el.tag)) return `<${el.tag}${attrsHtml(el.attrs, t)}>`;
  return `<${el.tag}${attrsHtml(el.attrs, t)}>${inner}</${el.tag}>`;
}

/** Static subtree back to HTML (cms-text initial content) */
function serialize(nodes: TNode[], t: Tpl): string {
  let out = "";
  for (const n of nodes) out += n.type === "text" ? t.html(n.value) : tagHtml(n, serialize(n.children, t), t);
  return out;
}

// ---------------------------------------------------------------------------
// cms-text — the tag becomes the wrapper, inner html is the initial content
// ---------------------------------------------------------------------------

async function renderCmsText(el: El, name: string, t: Tpl): Promise<string> {
  const target = await targetNode(el, t);
  if (!target) return "";
  const options: Record<string, unknown> = { tag: el.tag };
  for (const a of el.attrs) {
    if (a.name === "cms-text" || a.name === "node") continue;
    options[a.name] = a.value === null ? true : t.text(a.value);
  }
  const initial = serialize(el.children, t).trim();
  if (initial) options.initial = initial;
  return String(await target.cms.text(target, name, options));
}

// ---------------------------------------------------------------------------
// <cms-image name=... /> — rendered via cms.image2, attributes become options
// ---------------------------------------------------------------------------

async function renderCmsImage(el: El, t: Tpl): Promise<string> {
  const name = attrValue(el, "name", t);
  if (!name) { await warn(t.node, "<cms-image> without name"); return ""; }
  const target = await targetNode(el, t);
  if (!target) return "";
  const file = hasAttr(el, "localized") ? await target.cms.fileLang(target, name) : await target.file(name);
  if (!file) return "";
  const opts: Record<string, unknown> = { if: 1 };
  if (await target.edit()) opts.editable = await file.url();
  for (const a of el.attrs) {
    if (a.name === "name" || a.name === "localized" || a.name === "node") continue;
    opts[a.name] = a.value === null ? true : t.text(a.value);
  }
  if (opts.width)  opts.width  = Number(opts.width)  || opts.width;
  if (opts.height) opts.height = Number(opts.height) || opts.height;
  return String(await cms_image2(file, opts));
}

// ---------------------------------------------------------------------------
// <cms-cont name=... /> — embedded sub-content node
// ---------------------------------------------------------------------------

async function renderCmsCont(el: El, t: Tpl): Promise<string> {
  const name = attrValue(el, "name", t);
  if (!name) { await warn(t.node, "<cms-cont> without name"); return ""; }
  const target = await targetNode(el, t);
  if (!target) return "";
  const module = attrValue(el, "module", t) ?? attrValue(el, "default-module", t) ?? "cms.cont.flexible";
  return String(await (await target.cont(name, module)).html());
}

/** Static template text only: generated CMS content never passes through this resolver. */
async function templateValues(nodes: TNode[], node: Node): Promise<Record<string, TemplateValue>> {
  const named = placeholderNames(...templateTexts(nodes));
  const made = modulePlaceholders<Node>(node.app);
  const values: Record<string, TemplateValue> = {};
  for (const name of named) {
    const make = made[name];
    if (!make) { await warn(node, `unknown placeholder {{${name}}}`); continue; }
    const value = await make(node.app, node);
    if (value) values[name] = value;
  }
  return values;
}

function templateTexts(nodes: TNode[]): string[] {
  const texts: string[] = [];
  for (const node of nodes) {
    if (node.type === "text") texts.push(node.value);
    else texts.push(...node.attrs.flatMap((a) => a.value ?? []), ...templateTexts(node.children));
  }
  return texts;
}
