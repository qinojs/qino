import { html, sql, sqlSearch, type Ctx, type HtmlString } from "../core/mod.ts";
import type { Node } from "../cms/mod.ts";

export const name = "cms.cont.search1";
export const description = "Searches page titles and texts and lists the matching pages.";
export const needs = ["cms"];

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
  },
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const terms = (search: string) => search.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 4);

/** Text around the hits: matches marked, the stretches between them cut down to their edges. */
function snippet(text: string, words: string[], parts = 7, before = 30, after = 10): HtmlString {
  const plain = text.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  if (!words.length) return html`${plain.slice(0, before + after)}`;
  const out = plain.split(new RegExp(`(${words.map(escapeRe).join("|")})`, "i")).slice(0, parts).map((piece) =>
    words.includes(piece.toLowerCase())
      ? html`<mark>${piece}</mark>`
      : html`${piece.length > before + after + 3 ? `${piece.slice(0, after)}… ${piece.slice(-before)}` : piece}`
  );
  return html.join(out);
}

/** Matching pages, best first. A hit on a content counts for the page that carries it. */
async function hits(node: Node, ctx: Ctx, search: string) {
  const db = ctx.app.db;
  const words = terms(search);
  const { where } = sqlSearch(search, ["t.text"]);
  const pattern = String(node.settings.module() ?? "");
  const scope = pattern ? sql`AND p.module LIKE ${pattern}` : sql.raw("");
  const startId = Number(node.settings.startPage() ?? 0);
  const start = startId ? await node.cms.node(startId) : undefined;

  const titles = await db.query`
    SELECT p.id, t.text FROM page p
    JOIN text t ON t.id = p.title_id AND t.lang = ${ctx.lang}
    WHERE ${where} ${scope} LIMIT 100`;
  const texts = await db.query`
    SELECT p.id, t.text, pt.name FROM page p
    JOIN page_text pt ON pt.page_id = p.id
    JOIN text t ON t.id = pt.text_id AND t.lang = ${ctx.lang}
    WHERE ${where} ${scope} LIMIT 200`;

  const found = new Map<number, { page: Node; text: string; score: number }>();
  for (const [rows, isTitle] of [[titles, true], [texts, false]] as const) {
    for (const row of rows) {
      const hit = await node.cms.node(Number(row.id));
      const page = await hit.page();
      if (!page.vs.searchable) continue;
      if (!await hit.isReadable()) continue;
      if (start && !await hit.in(start)) continue;

      const group = found.get(page.id) ?? { page, text: "", score: 0 };
      const text = String(row.text ?? "");
      if (isTitle) {
        group.score += 3;
      } else {
        const plain = text.replace(/<[^>]*>/g, " ").toLowerCase();
        const count = words.reduce((n, w) => n + plain.split(w).length - 1, 0);
        group.score += 0.2 * Math.min(count, 7);
        // Names starting with "_" are internal texts — searchable, but not worth showing.
        if (!String(row.name ?? "").startsWith("_")) group.text += " " + text;
      }
      found.set(page.id, group);
    }
  }
  return [...found.values()].sort((a, b) => b.score - a.score);
}

async function item(node: Node, page: Node, text: string, words: string[]): Promise<HtmlString> {
  const href = await page.url();
  const cms = node.cms;

  let image: HtmlString | string = "";
  if (await node.settings["preview image"]) {
    const file = Object.values(await page.files()).find((f) => f.mime.startsWith("image/"));
    if (file) image = html`<a href="${href}"><img src="${await file.url({ w: 120, h: 400, max: true })}" alt=""></a>`;
  }

  let path: HtmlString | string = "";
  if (await node.settings.breadcrumb) {
    const links: HtmlString[] = [];
    for (const p of (await page.path()).values()) {
      if (p.id === 1 || !String(await p.showTitle()).trim()) continue;
      links.push(await cms.link(p));
    }
    path = html`<div class=-breadcrumb>${html.join(links, " - ")}</div>`;
  }

  return html.async`<div class=-item>
    ${image}
    <div class=-title>${cms.link(page)}</div>
    ${path}
    <a href="${href}" class=-content>${snippet(text, words)}</a>
  </div>`;
}

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const t = ctx.app.t;
  const search = String(ctx.req.query[QUERY] ?? "").trim();

  let form: Promise<HtmlString> | HtmlString | string = "";
  if (!await node.settings["hide input"]) {
    // The page may be addressed by parameters (cmspid, editmode, a language) — carry them along.
    const keep = Object.entries(ctx.req.query)
      .filter(([k, v]) => k !== QUERY && typeof v === "string")
      .map(([k, v]) => html`<input type=hidden name="${k}" value="${v}">`);
    form = html.async`<form>${html.join(keep)}
      <input type=search name="${QUERY}" value="${search}" placeholder="${t`Search`}" autofocus>
      <button>${t`Search`}</button>
    </form>`;
  }

  if (!search) return html.async`<div>${form}</div>`;
  const results = await hits(node, ctx, search);
  const words = terms(search);
  return html.async`<div>${form}
    ${results.length
      ? html.join(await Promise.all(results.map((r) => item(node, r.page, r.text, words))))
      : html.async`<div class=-empty>${t`No results found`}</div>`}
  </div>`;
}

export const cms = {
  node: { render, settingsSchema },
};
