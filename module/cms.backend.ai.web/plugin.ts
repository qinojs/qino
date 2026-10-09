// deno-lint-ignore-file no-explicit-any
import { errMsg, html, sql } from "@qino/qino";
import * as u2 from "@qino/qino/u2";
import { backend } from "@qino/qino/cms.backend";
import { crawl, ENGINES, pages, read, READERS, search } from "@qino/qino/ai.web";

import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

type Vars = Record<string, any>;

const { name } = manifest;
const { uniqueColor, ageColor } = backend;
const LIMIT = 100;
/** Where each key is made. */
const CONSOLES: Record<string, string> = {
  "api.search.brave.com": "https://api-dashboard.search.brave.com/app/keys",
  "google.serper.dev": "https://serper.dev/api-key",
  "api.jina.ai": "https://jina.ai/api-dashboard/key-manager",
  "api.firecrawl.dev": "https://www.firecrawl.dev/app/api-keys",
};

const colored = (value: unknown) => html`<span style="color:${uniqueColor(value)}">${value}</span>`;
const time = (value: unknown) => value ? html`<span style="color:${ageColor(value)}; white-space:nowrap">${u2.el.time(value, { narrow: true })}</span>` : "–";
/** The services with a key: the search engines, then the readers. */
const services = () => [
  ...Object.keys(ENGINES).map((key) => ({ key, use: "search" })),
  ...Object.entries(READERS).flatMap(([reader, { key }]) => key ? [{ key, use: `reader ${reader}` }] : []),
];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Web", de: "Web" });
}

/** The pages read, the latest first; with `vars.search` the nearest to it, with `vars.root` only those
 *  below it. Their content folded. */
export async function list(node: Node, { vars = {} }: { vars?: Vars } = {}): Promise<HtmlString> {
  const { db, t } = node.app;
  const rows = await pages(node.app, vars.search ? String(vars.search) : undefined, { root: vars.root ? String(vars.root) : undefined, limit: LIMIT });
  const content = new Map((await db.query`SELECT id, content FROM ai_web_page WHERE ${sql.in("id", rows.map((r: any) => r.id))}`)
    .map((r) => [Number(r.id), String(r.content ?? "")]));
  return html.async`
    <thead><tr>
      <th>#
      <th>${t`Page`}
      <th>${t`Reader`}
      <th>${t`Characters`}
      <th title="${t`How close to the search by meaning: 1 the same, the smaller the farther`}">${t`Score`}
      <th>${t`Read`}
      <th>
    <tbody>${rows.length ? rows.map((p: any) => html`<tr data-id="${p.id}">
      <td>${p.id}
      <td>
        <a href="${p.url}" target=_blank rel=noopener>${p.url}</a>
        <details><summary>${p.title || "–"}${p.part ? html` <small>${p.part.slice(0, 120)} …</small>` : ""}</summary>
          <pre style="white-space:pre-wrap; max-height:20rem; overflow:auto"><small>${content.get(Number(p.id))}</small></pre></details>
      <td>${colored(p.reader)}
      <td>${(content.get(Number(p.id)) ?? "").length.toLocaleString("en-US")}
      <td>${p.score == null ? "–" : Number(p.score).toFixed(3)}
      <td>${time(p.time)}
      <td><button type=button class=u2-unstyle data-remove title=remove><u2-ico icon=delete>✕</u2-ico></button>`)
      : html.async`<tr><td colspan=7>${t`No pages yet`}`}</tbody>`;
}

async function render(node: Node) {
  const app = node.app, t = app.t;
  const reader = String(await app.settings["ai.web"].reader);
  const keys = await Promise.all(services().map(async (s) => ({ ...s, value: String(await app.settings.core.keys[s.key] ?? "") })));
  return html.async`<div class=u2-flex>
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head>${t`Settings`}</div>
    <table class=u2-table>
      <tr>
        <th title="${t`Our own fetch costs nothing and tells nobody; a service renders scripts and reads PDFs`}">${t`Reader`}
        <td><select data-reader>${Object.keys(READERS).map((r) => html`<option ${r === reader ? "selected" : ""}>${r}`)}</select>
    </table>
    <table class=u2-table>
      <thead><tr>
        <th>${t`Service`}
        <th>${t`For`}
        <th>${t`Key`}
      <tbody>${keys.map((k) => html.async`<tr data-key="${k.key}">
        <th>${k.key}
        <td>${k.use}
        <td style="white-space:nowrap">
          ${CONSOLES[k.key] ? html.async`<a href="${CONSOLES[k.key]}" target=_blank rel=noopener title="${t`Get a key`}"><u2-ico icon=open_in_new>↗</u2-ico></a>` : ""}
          <button type=button class=u2-unstyle data-set-key title="${t`Set key`}"><u2-ico icon=key>⚿</u2-ico></button>
          <small class=u2-badge style="--color-dark:var(${k.value ? "--green" : "--gray"})">${k.value ? `…${k.value.slice(-4)}` : t`no key`}</small>`)}</tbody>
    </table>
  </div>
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head>${t`Try`}</div>
    <form data-search class=u2-flex>
      <input name=query required placeholder="${t`Search the web`}">
      <button>${t`Search`}</button>
    </form>
    <form data-read class=u2-flex>
      <input name=url type=url required placeholder="https://…">
      <button>${t`Read`}</button>
    </form>
    <form data-crawl class=u2-flex>
      <input name=url type=url required placeholder="https://…" title="${t`Only links that start with it are followed`}">
      <input name=max type=number min=1 value=100 title="${t`How many pages at most`}" style="width:6rem">
      <label><input type=checkbox name=fresh> ${t`all again`}</label>
      <button>${t`Crawl`}</button>
    </form>
    <output data-tried style="display:block; white-space:pre-wrap; max-height:20rem; overflow:auto"></output>
  </div>
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head>${t`Pages read`}</div>
    <form data-find class=u2-flex>
      <input type=search name=search placeholder="${t`Find by meaning`}">
      <input type=search name=root placeholder="${t`Only below, e.g. https://…`}">
      <button>${t`Find`}</button>
    </form>
    <div style="max-height:60vh; overflow:auto; padding:0"><table class=u2-table cms-part=list>${list(node)}</table></div>
  </div>
</div>`;
}

/** Choose the reader, set a key, try a search or a read, remove a page. */
async function api(node: Node, vars: Vars): Promise<unknown> {
  const app = node.app;
  try {
    if (vars.reader) {
      if (!(vars.reader in READERS)) throw new Error(`No reader "${vars.reader}"`);
      await app.settings["ai.web"].reader(String(vars.reader));
    } else if (vars.key) {
      if (!services().some((s) => s.key === vars.key.name)) throw new Error(`Not a key of ai.web: ${vars.key.name}`);
      await app.settings.core.keys[vars.key.name](String(vars.key.value ?? "").trim());
    } else if (vars.search) return { ok: true, result: await search(app, String(vars.search)) };
    else if (vars.read) return { ok: true, result: await read(app, String(vars.read), { maxAge: 0 }) };
    else if (vars.crawl) {
      if (!/^https?:\/\//i.test(vars.crawl.url)) throw new Error("url: http or https");
      return { ok: true, result: await crawl(app, String(vars.crawl.url), { max: Number(vars.crawl.max) || undefined, maxAge: vars.crawl.fresh ? 0 : undefined }) };
    }
    else if (vars.remove) await app.db.table("ai_web_page").delete(Number(vars.remove));
    else return null;
    return { ok: true };
  } catch (e) { return { ok: false, message: errMsg(e) }; }
}

export const cms = { node: { js: ["pub/main.js"], render, api, parts: { list } } };
