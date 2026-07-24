import dbSchema from "./dbschema.json" with { type: "json" };
import { hee, u2time, unixTime, type App } from "../core/mod.ts";
import type { Node } from "../cms/mod.ts";
import { backend } from "../cms.backend/mod.ts";
import { checkSite } from "./lib/check.ts";

export const name = "cms.backend.monitor";
export const needs = ["cms.backend"];
export { dbSchema };
export const cms = { node: { js: ["pub/main.js"], render, api } };

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, "cms.backend.monitor", { en: "Monitor", de: "Überwachung" });
}

type Row = Record<string, any>;

// A bare domain becomes https://; an explicit scheme is kept.
const normalizeUrl = (s: string): string => {
  s = s.trim();
  if (!s) return "";
  const u = /^https?:\/\//i.test(s) ? s : "https://" + s;
  try { return new URL(u).href.replace(/\/$/, ""); } catch { return ""; }
};

async function runCheck(app: App, site: Row): Promise<void> {
  const r = await checkSite(site.url);
  await app.db.table("monitor_site").update(site.id, {
    online: r.online,
    status_code: r.statusCode,
    response_time: r.responseTime,
    cert_valid: r.certValid,
    redirect_https: r.redirectHttps,
    dns_ns: r.dns.ns.join("\n"),
    dns_a: r.dns.a.join("\n"),
    dns_aaaa: r.dns.aaaa.join("\n"),
    dns_mx: r.dns.mx.join("\n"),
    dns_txt: r.dns.txt.join("\n"),
    error: r.error,
    checked: unixTime(),
  });
}

// Mutations arrive as `vars` from cms.reloadNode (background apt POST, no full reload).
async function handleAction(app: App, vars: Record<string, any>): Promise<void> {
  const table = app.db.table("monitor_site");

  if (vars.add) {
    const urls = [...new Set(String(vars.urls ?? "").split(/[\s,]+/).map(normalizeUrl).filter(Boolean))];
    const added: Row[] = [];
    for (const url of urls) {
      if (await app.db.one`SELECT id FROM monitor_site WHERE url = ${url}`) continue; // skip duplicates
      const id = await table.insert({ url, created: unixTime() });
      const site = await app.db.row`SELECT * FROM monitor_site WHERE id = ${id}`;
      if (site) added.push(site);
    }
    await Promise.all(added.map((s) => runCheck(app, s)));
    return;
  }
  if (vars.checkAll) {
    const sites = await app.db.query`SELECT * FROM monitor_site`;
    await Promise.all(sites.map((s) => runCheck(app, s)));
  }
}

// Row-level mutations: return JSON so the client updates in place, keeping search/sort state.
async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  const app = node.app;
  if (vars.delete) {
    await app.db.table("monitor_site").delete(Number(vars.delete));
    return { done: true };
  }
  if (vars.check) {
    const id = Number(vars.check);
    const site = await app.db.row`SELECT * FROM monitor_site WHERE id = ${id}`;
    if (!site) return { done: false };
    await runCheck(app, site);
    const fresh = await app.db.row`SELECT * FROM monitor_site WHERE id = ${id}`;
    return fresh ? { row: rowHtml(fresh) } : { done: false };
  }
  return false;
}

// Status dot: green/red for true/false, muted for unknown (null).
const dot = (v: unknown, title: string) => {
  const style = v == null ? "opacity:.3" : `color:var(${v ? "--green" : "--red"})`;
  return `<span title="${hee(title)}" style="${style}">●</span>`;
};

// Sort rank for tri-state dot columns: unknown < offline/bad < online/good.
const rank = (v: unknown) => v == null ? 0 : v ? 2 : 1;

// One DNS record per line so the same type lines up across rows for comparison.
const dnsCell = (v: string): string => {
  const list = (v ?? "").split("\n").filter(Boolean);
  return list.length ? `<small>${list.map(hee).join("<br>")}</small>` : "–";
};

function rowHtml(r: Row): string {
  const host = (() => { try { return new URL(r.url).hostname; } catch { return r.url; } })();
  const del = `<button class=u2-unstyle data-action=delete data-id="${hee(r.id)}" u2-confirm="${hee(`Delete ${host}?`)}"><u2-ico icon=delete>✕</u2-ico></button>`;
  const check = `<button class=u2-unstyle data-action=check data-id="${hee(r.id)}" title="Check now"><u2-ico icon=refresh>↻</u2-ico></button>`;
  return `<tr>
      <td data-value="${rank(r.online)}">${dot(r.online, r.error || (r.online ? "online" : r.checked ? "offline" : "not checked yet"))}
      <td data-value="${hee(host)}"><a href="${hee(r.url)}" target=_blank>${hee(host)}</a>${r.error ? `<br><small>${hee(r.error)}</small>` : ""}
      <td data-value="${r.status_code ?? ""}">${r.status_code ?? "–"}
      <td data-value="${r.response_time ?? ""}">${r.response_time != null ? r.response_time + " ms" : "–"}
      <td data-value="${rank(r.cert_valid)}">${dot(r.cert_valid, r.cert_valid == null ? "no https" : r.cert_valid ? "cert valid" : "cert invalid")}
      <td data-value="${rank(r.redirect_https)}">${dot(r.redirect_https, r.redirect_https == null ? "unknown" : r.redirect_https ? "http→https" : "no https redirect")}
      <td data-value="${hee(r.dns_ns)}">${dnsCell(r.dns_ns)}
      <td data-value="${hee(r.dns_a)}">${dnsCell(r.dns_a)}
      <td data-value="${hee(r.dns_aaaa)}">${dnsCell(r.dns_aaaa)}
      <td data-value="${hee(r.dns_mx)}">${dnsCell(r.dns_mx)}
      <td data-value="${hee(r.dns_txt)}">${dnsCell(r.dns_txt)}
      <td data-value="${r.checked ?? 0}">${u2time(r.checked)}
      <td style="white-space:nowrap">${check}${del}`;
}

async function render(node: Node, { vars = {} }: { vars?: Record<string, any> } = {}): Promise<string> {
  const app = node.app;
  await handleAction(app, vars);

  const rows: Row[] = await app.db.query`SELECT * FROM monitor_site ORDER BY sort, id`;
  const body = rows.map(rowHtml).join("\n");
  const empty = rows.length ? "" : '<tr><td colspan="13" style="text-align:center;padding:1em">No sites yet.';

  return `<div class="u2-card">
  <div class="-head">Monitor (<span data-monitor-count>${rows.length}</span>)</div>
  <div class="-body" style="display:flex; gap:.5rem; flex-wrap:wrap; align-items:center">
    <input type=search placeholder="search…" data-monitor-search style="width:15rem; max-width:100%">
    <select data-monitor-filter>
      <option value="">all</option>
      <option value="up">online</option>
      <option value="down">offline</option>
    </select>
    <button data-action=checkAll style="margin-left:auto">Check all</button>
  </div>
  <u2-table style="padding:0; max-height:85vh; overflow:auto">
    <table class="u2-table -Sticky" style="white-space:nowrap;">
      <thead><tr>
        <th data-sort-handler width=2>Status
        <th data-sort-handler>Site
        <th data-sort-handler width=5>Code
        <th data-sort-handler>Time
        <th data-sort-handler width=3>Cert
        <th data-sort-handler>HTTPS
        <th data-sort-handler>NS
        <th data-sort-handler>A
        <th data-sort-handler>AAAA
        <th data-sort-handler>MX
        <th data-sort-handler>TXT
        <th data-sort-handler width=5>Checked
        <th width=1>
      <tbody>${body || empty}
    </table>
  </u2-table>
  <div class="-body" style="display:flex; gap:.5rem; flex-wrap:wrap; align-items:end">
    <label style="flex:1">Add sites <small>(one per line, https optional)</small><br><textarea name=urls rows=3 placeholder="example.com&#10;https://sub.example.org" style="width:100%"></textarea></label>
    <button data-action=add>Add</button>
  </div>
</div>`;
}
