import { html, sql, sqlSearch, unhee } from "@qino/qino";
import * as u2 from "@qino/qino/u2";

import { record } from "./record.ts";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

// Shared by every search content on a page — one term per request is what a visitor expects.
const QUERY = "cms_search";

const settingsSchema = {
  properties: {
    "hide input": {
      type: "boolean",
      description: "Renders only the results — for a search field that lives elsewhere on the page.",
    },
    startPage: {
      type: "integer",
      minimum: 1,
      description: "Restricts results to this page and its descendants.",
      "x-html": { type: "qgcms-page" },
    },
    module: {
      type: "string",
      description: "Restricts results to pages whose module matches this LIKE pattern.",
    },
    breadcrumb: {
      type: "boolean",
      description: "Shows the path to each result.",
    },
    "preview image": {
      type: "boolean",
      description: "Shows the first image attached to a result.",
    },
    "group by": {
      enum: ["pages", "contents"], default: "pages",
      description: "One result per page, or per titled content — then a hit links straight to its section.",
    },
  },
};

const terms = (search: string) => search.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 4);

/** Text around the hits: matches marked, the stretches between them cut down to their edges. */
function snippet(text: string, words: string[], parts = 7, before = 30, after = 10) {
  const plain = unhee(text.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim(); // \s takes the decoded &nbsp; too
  if (!words.length) return html`${plain.slice(0, before + after)}`;
  const out = plain.split(new RegExp(`(${words.map(RegExp.escape).join("|")})`, "i")).slice(0, parts).map((piece) =>
    words.includes(piece.toLowerCase())
      ? html`<mark>${piece}</mark>`
      : html`${piece.length > before + after + 3 ? `${piece.slice(0, after)}… ${piece.slice(-before)}` : piece}`
  );
  return html.join(out);
}

/** The visible, titled content around a hit, or else its page: what a hit links to when grouped by contents. */
async function section(hit: Node): Promise<Node> {
  for (let n: Node | undefined = hit; n?.vs.type === "c"; n = await n.parent())
    if (n.vs.visible && (await n.showTitle()).plain()) return n;
  return hit.page();
}

/** Matching pages, best first. A hit on a content counts for the page that carries it, or for its
 *  section when grouped by contents. */
async function hits(node: Node, ctx: Ctx, search: string) {
  const db = ctx.app.db;
  const words = terms(search);
  const { where } = sqlSearch(search, ["t.text"]);
  const pattern = String(node.settings.module() ?? "");
  const scope = pattern ? sql`AND p.module LIKE ${pattern}` : sql``;
  const startId = Number(node.settings.startPage() ?? 0);
  const start = startId ? await node.cms.node(startId) : undefined;
  const bySection = node.settings["group by"]() === "contents";

  const [titles, texts] = await Promise.all([
    db.query`
      SELECT p.id, t.text FROM page p
      JOIN text_lang t ON t.text_id = p.title_id AND t.lang = ${ctx.lang}
      WHERE ${where} ${scope} LIMIT 100`,
    db.query`
      SELECT p.id, t.text, pt.name FROM page p
      JOIN page_text pt ON pt.page_id = p.id
      JOIN text_lang t ON t.text_id = pt.text_id AND t.lang = ${ctx.lang}
      WHERE ${where} ${scope} LIMIT 200`,
  ]);

  // checked all at once: each hit loads its node, page and access
  const rows = [...titles.map((row) => ({ row, isTitle: true })), ...texts.map((row) => ({ row, isTitle: false }))];
  const pages = await Promise.all(rows.map(async ({ row }) => {
    const hit = await node.cms.node(Number(row.id));
    const page = await hit.page();
    if (!page.vs.searchable || !await hit.isReadable()) return;
    if (start && !await hit.in(start)) return;
    return bySection ? section(hit) : page;
  }));

  const found = new Map<number, { page: Node; text: string; score: number }>();
  rows.forEach(({ row, isTitle }, i) => {
    const page = pages[i];
    if (!page) return;
    const group = found.getOrInsertComputed(page.id, () => ({ page, text: "", score: 0 }));
    const text = String(row.text ?? "");
    if (isTitle) group.score += 3;
    else {
      const plain = text.replace(/<[^>]*>/g, " ").toLowerCase();
      const count = words.reduce((n, w) => n + plain.split(w).length - 1, 0);
      group.score += 0.2 * Math.min(count, 7);
      // Names starting with "_" are internal texts — searchable, but not worth showing.
      if (!String(row.name ?? "").startsWith("_")) group.text += " " + text;
    }
  });
  return [...found.values()].sort((a, b) => b.score - a.score);
}

/** One link per hit, on its title; u2-href makes the whole hit follow it. */
async function item(node: Node, page: Node, text: string, words: string[]) {
  const cms = node.cms;

  let image: HtmlString | string = "";
  if (await node.settings["preview image"]) {
    const file = (await page.files()).values().find((f) => f.mime.startsWith("image/"));
    if (file) image = html`<img src="${await file.url({ w: 120, h: 400, max: true })}" alt="" loading=lazy>`;
  }

  let path: HtmlString | string = "";
  if (await node.settings.breadcrumb) {
    const links = [];
    for (const p of (await page.path()).values()) {
      if (p.id === 1 || !(await p.showTitle()).plain()) continue;
      links.push(await cms.link(p));
    }
    path = html`<div class=-breadcrumb>${html.join(links, " - ")}</div>`;
  }

  return html.async`<li u2-href>${image}
    <div>
      <div class=-title>${cms.link(page)}</div>
      ${path}
      <p class=-content>${snippet(text, words)}</p>
    </div>
  </li>`;
}

/** The results for a term; also rendered alone as the part "hits" while the visitor types. */
async function results(node: Node, ctx: Ctx, search: string, vars: Record<string, unknown> = {}) {
  if (!search) return "";
  const found = await hits(node, ctx, search);
  const entry = await record(node, ctx, search, found.length, vars);
  const words = terms(search);
  const list = found.length
    ? html.async`<ol>${found.map((r) => item(node, r.page, r.text, words))}</ol>`
    : html.async`<p class=-empty>${ctx.app.t`No results found`}</p>`;
  return html.async`${entry}${list}`;
}

async function render(node: Node, { ctx }: { ctx: Ctx }) {
  const t = ctx.app.t;
  const search = String(ctx.req.query[QUERY] ?? "").trim();
  u2.assets(ctx, ["attr/href/href.js"]);

  let form: Promise<HtmlString> | HtmlString | string = "";
  if (!await node.settings["hide input"]) {
    // The page may be addressed by parameters (cmspid, editmode, a language) — carry them along.
    const keep = Object.entries(ctx.req.query)
      .filter(([k, v]) => k !== QUERY && typeof v === "string")
      .map(([k, v]) => html`<input type=hidden name="${k}" value="${v}">`);
    form = html.async`<search><form>${keep}
      <input type=search name="${QUERY}" value="${search}" placeholder="${t`Search`}" aria-label="${t`Search`}">
      <button>${t`Search`}</button>
    </form></search>`;
  }

  // aria-live: results replaced while typing are announced
  return html.async`<div>${form}
    <div cms-part=hits aria-live=polite>${results(node, ctx, search)}</div>
  </div>`;
}

const hitsPart = (node: Node, { ctx, vars }: { ctx: Ctx; vars: Record<string, unknown> }) =>
  results(node, ctx, String(vars.search ?? "").trim(), vars);

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

export const cms = {
  node: { render, settingsSchema, css: ["pub/main.css"], js: ["pub/main.js"], parts: { hits: hitsPart } },
};
