import type { TNode, TAttr } from "./parse.ts";
import type { Node } from "../cms/lib/Node.ts";
import { hee } from "../core/lib/util.ts";
import { getCtx } from "../core/lib/RequestContext.ts";

const VOID_ELEMENTS = new Set(["area","base","br","col","embed","hr","img","input","link","meta","param","source","track","wbr"]);
const LANG_CODES    = new Set(["de","en","fr","it","es","nl","pl","cz","pt"]);

type RenderCtx = { node: Node; vars: Record<string, unknown> }

// ---------------------------------------------------------------------------
// Expression evaluator — scope available in {expr} and attribute expressions
// ---------------------------------------------------------------------------

async function evalExpr(code: string, rctx: RenderCtx, extra: Record<string, unknown> = {}): Promise<unknown> {
  const ctx  = getCtx();
  const node = rctx.node;
  const scope: Record<string, unknown> = {
    setting: new Proxy({}, { get(_t, prop: string) { return node.settings[prop]?.() ?? ""; } }),
    url:     await node.url(),
    lang:    ctx.lang,
    node,
    files:   await node.files(),
    conts:   await node.conts(),
    ...extra,
  };
  try {
    const fn  = new Function(...Object.keys(scope), `"use strict"; return (${code.trim()});`);
    const result = fn(...Object.values(scope));
    return result instanceof Promise ? await result : result;
  } catch { return ""; }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function renderAttrValue(nodes: TAttr["value"], rctx: RenderCtx, extra: Record<string, unknown> = {}): Promise<string> {
  let out = "";
  for (const n of nodes) {
    out += n.type === "text" ? n.value : n.type === "expr" ? String((await evalExpr(n.code, rctx, extra)) ?? "") : "";
  }
  return out;
}

const findAttr = (attrs: TAttr[], name: string) => attrs.find(a => a.name === name);

// ---------------------------------------------------------------------------
// Core renderer
// ---------------------------------------------------------------------------

export async function renderNodes(nodes: TNode[], rctx: RenderCtx, extra: Record<string, unknown> = {}): Promise<string> {
  let out = "";
  for (const n of nodes) out += await renderNode(n, rctx, extra);
  return out;
}

async function renderNode(node: TNode, rctx: RenderCtx, extra: Record<string, unknown>): Promise<string> {
  if (node.type === "text")   return node.value;
  if (node.type === "expr")   return hee(String((await evalExpr(node.code, rctx, extra)) ?? ""));
  return renderElement(node, rctx, extra);
}

async function renderElement(el: Extract<TNode, { type: "element" }>, rctx: RenderCtx, extra: Record<string, unknown>): Promise<string> {
  const { tag, attrs, children } = el;

  // cms-if
  const ifAttr = findAttr(attrs, "cms-if");
  if (ifAttr) {
    if (!await evalExpr(ifAttr.raw, rctx, extra)) return "";
    return renderElement({ ...el, attrs: attrs.filter(a => a.name !== "cms-if") }, rctx, extra);
  }

  // cms-each
  const eachAttr = findAttr(attrs, "cms-each");
  if (eachAttr) return renderEach(eachAttr.raw, el, attrs.filter(a => a.name !== "cms-each"), children, rctx, extra);

  // cms-text
  const cmsText = findAttr(attrs, "cms-text");
  if (cmsText) return renderCmsText(tag, cmsText.raw, attrs, rctx);

  // cms-image
  const cmsImage = findAttr(attrs, "cms-image");
  if (cmsImage) {
    const name = await renderAttrValue(cmsImage.value, rctx, extra) || cmsImage.raw;
    return renderCmsImage(name, attrs, rctx, extra);
  }

  // cms-cont
  const cmsCont = findAttr(attrs, "cms-cont");
  if (cmsCont) return renderCmsCont(cmsCont.raw, attrs, rctx.node);

  // cms-part — attribute stays in output so cms.reloadPart() can find it
  const cmsPart = findAttr(attrs, "cms-part");
  if (cmsPart) return renderTag(tag, attrs, await renderNodes(children, rctx, extra), false, rctx, extra);

  // plain element
  return renderTag(tag, attrs, el.self ? "" : await renderNodes(children, rctx, extra), el.self, rctx, extra);
}

async function renderTag(tag: string, attrs: TAttr[], inner: string, selfClose: boolean, rctx: RenderCtx, extra: Record<string, unknown>): Promise<string> {
  let attrStr = "";
  for (const a of attrs) {
    const val = await renderAttrValue(a.value, rctx, extra);
    attrStr += val === "" && a.value.length === 0 ? ` ${a.name}` : ` ${a.name}="${hee(val)}"`;
  }
  if (selfClose && VOID_ELEMENTS.has(tag)) return `<${tag}${attrStr}>`;
  return `<${tag}${attrStr}>${inner}</${tag}>`;
}

// ---------------------------------------------------------------------------
// cms-text
// ---------------------------------------------------------------------------

async function renderCmsText(tag: string, name: string, attrs: TAttr[], rctx: RenderCtx): Promise<string> {
  const initial: Record<string, string> = {};
  for (const a of attrs) {
    if (LANG_CODES.has(a.name)) initial[a.name] = a.raw;
  }
  const options: Record<string, unknown> = { tag };
  if (Object.keys(initial).length) options.initial = initial;
  return String(await rctx.node.cms.text(rctx.node, name, options));
}

// ---------------------------------------------------------------------------
// cms-image
// ---------------------------------------------------------------------------

async function renderCmsImage(name: string, attrs: TAttr[], rctx: RenderCtx, extra: Record<string, unknown>): Promise<string> {
  const fileAttr = findAttr(attrs, ":file");
  const dbFile   = fileAttr
    ? await evalExpr(fileAttr.raw, rctx, extra)
    : await rctx.node.cms.fileLang(rctx.node, name);

  if (!dbFile) return "";

  try {
    const { cms_image2 } = await import("../cms.image2/mod.ts");
    const skip = new Set(["cms-image", ":file"]);
    const opts: Record<string, unknown> = { if: 1 };
    for (const a of attrs) {
      if (skip.has(a.name)) continue;
      const v = await renderAttrValue(a.value, rctx, extra);
      opts[a.name] = v === "" ? true : v;
    }
    if (opts.width)  opts.width  = Number(opts.width)  || opts.width;
    if (opts.height) opts.height = Number(opts.height) || opts.height;
    return String(await cms_image2(dbFile as Parameters<typeof cms_image2>[0], opts));
  } catch { return ""; }
}

// ---------------------------------------------------------------------------
// cms-cont
// ---------------------------------------------------------------------------

async function renderCmsCont(name: string, attrs: TAttr[], cmsNode: Node): Promise<string> {
  const mod = findAttr(attrs, "module")?.raw ?? findAttr(attrs, "default-module")?.raw ?? "cms.cont.flexible";
  return String(await (await cmsNode.cont(name, mod)).html());
}

// ---------------------------------------------------------------------------
// cms-each
// ---------------------------------------------------------------------------

async function renderEach(spec: string, el: Extract<TNode, { type: "element" }>, attrs: TAttr[], children: TNode[], rctx: RenderCtx, extra: Record<string, unknown>): Promise<string> {
  const m = spec.match(/^(.+?)\s+as\s+(\w+)$/);
  if (!m) return "";
  const [, iterExpr, varName] = m;

  let items: unknown[];
  const rangeM = iterExpr.trim().match(/^(\d+)\.\.(\d+)$/);
  if (rangeM) {
    const from = Number(rangeM[1]), to = Number(rangeM[2]);
    items = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  } else {
    const val = await evalExpr(iterExpr, rctx, extra);
    if (val instanceof Map)                     items = [...val.values()];
    else if (Array.isArray(val))                items = val;
    else if (val && typeof val === "object")    items = Object.values(val as object);
    else return "";
  }

  let out = "";
  for (let idx = 0; idx < items.length; idx++) {
    const loopExtra = { ...extra, [varName]: items[idx], [`${varName}Index`]: idx };
    out += await renderTag(el.tag, attrs, await renderNodes(children, rctx, loopExtra), false, rctx, loopExtra);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Part extractor + public builders
// ---------------------------------------------------------------------------

export function extractParts(nodes: TNode[]): Record<string, TNode[]> {
  const parts: Record<string, TNode[]> = {};
  const visit = (ns: TNode[]) => ns.forEach(n => {
    if (n.type !== "element") return;
    const p = n.attrs.find(a => a.name === "cms-part");
    if (p) parts[p.raw] = n.children;
    visit(n.children);
  });
  visit(nodes);
  return parts;
}

export function buildRenderFn(ast: TNode[]) {
  return (node: Node, { vars = {} }: { vars?: Record<string, unknown> } = {}) => renderNodes(ast, { node, vars });
}

export function buildPartFn(partAst: TNode[]) {
  return (node: Node, { vars = {} }: { vars?: Record<string, unknown> } = {}) => renderNodes(partAst, { node, vars });
}
