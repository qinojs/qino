import dbSchema from "./dbschema.json" with { type: "json" };
import { html, type HtmlString, sql, u2time, unixTime, type App } from "../core/mod.ts";
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

// A bare domain becomes https://; an explicit scheme is kept. Everything that is not a
// plausible web host — other schemes, bare words, userinfo, bare IPs — returns "".
const normalizeUrl = (s: string): string => {
  s = s.trim();
  if (!s) return "";
  const scheme = s.match(/^([a-z][a-z0-9+.-]*):\/\//i)?.[1].toLowerCase();
  if (scheme && scheme !== "http" && scheme !== "https") return "";
  try {
    const u = new URL(scheme ? s : "https://" + s);
    if (u.username || u.password) return "";
    if (!/^([a-z0-9](-*[a-z0-9])*\.)+[a-z]{2,}$/i.test(u.hostname)) return ""; // labels + alphabetic TLD
    return u.href.replace(/\/$/, "");
  } catch { return ""; }
};

async function runCheck(app: App, site: Row): Promise<void> {
  const r = await checkSite(site.url, site.expect);
  const dns: Row = {};
  for (const [k, list] of Object.entries(r.dns)) dns["dns_" + k] = list.join("\n");
  // remember when a record set last moved — silent DNS changes are worth noticing
  const changed = Object.entries(dns).some(([k, v]) => site[k] != null && site[k] !== v);
  await app.db.table("monitor_site").update(site.id, {
    ...dns,
    online: r.online,
    status_code: r.statusCode,
    response_time: r.responseTime,
    final_url: r.finalUrl,
    cert_valid: r.certValid,
    cert_days: r.certDays,
    redirect_https: r.redirectHttps,
    ipv6: r.ipv6,
    www_ok: r.wwwOk,
    ns_answering: r.nsAnswering,
    ns_in_sync: r.nsInSync,
    dns_changed: changed ? unixTime() : site.dns_changed,
    error: r.error,
    checked: unixTime(),
  });
}

// The pasted list arrives as `vars` from cms.reloadNode (background apt POST, no full reload).
// Returns the entries that were no usable host, so the form can name them.
async function addSites(app: App, list: string): Promise<string[]> {
  const table = app.db.table("monitor_site");
  const added: Row[] = [];
  const skipped: string[] = [];
  for (const raw of new Set(list.split(/[\s,]+/).filter(Boolean))) {
    const url = normalizeUrl(raw);
    if (!url) { skipped.push(raw); continue; }
    if (await app.db.one`SELECT id FROM monitor_site WHERE url = ${url}`) continue; // skip duplicates
    const id = await table.insert({ url, created: unixTime() });
    const site = await app.db.row`SELECT * FROM monitor_site WHERE id = ${id}`;
    if (site) added.push(site);
  }
  await Promise.all(added.map((s) => runCheck(app, s)));
  return skipped;
}

// Which sites a check covers: everything, everything with a red mark, or an explicit id list.
async function sitesFor(app: App, scope: string): Promise<Row[]> {
  const db = app.db;
  if (scope === "all") return await db.query`SELECT * FROM monitor_site`;
  if (scope === "failed") {
    return await db.query`SELECT * FROM monitor_site
      WHERE checked IS NULL OR error IS NOT NULL OR online = ${false} OR cert_valid = ${false} OR cert_days < 14
        OR redirect_https = ${false} OR ipv6 = ${false} OR www_ok = ${false} OR ns_in_sync = ${false}`;
  }
  const ids = scope.split(",").map(Number).filter(Boolean);
  if (!ids.length) return [];
  return await db.query`SELECT * FROM monitor_site WHERE id IN (${sql.join(ids.map((id) => sql`${id}`), ",")})`;
}

// Row-level mutations: return JSON so the client updates in place, keeping search/sort state.
async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  const app = node.app;
  if (vars.delete) {
    await app.db.table("monitor_site").delete(Number(vars.delete));
    return { done: true };
  }
  if (vars.expect) await app.db.table("monitor_site").update(Number(vars.expect), { expect: String(vars.value ?? "") });
  const scope = String(vars.check ?? vars.expect ?? "");
  if (!scope) return false;
  const sites = await sitesFor(app, scope);
  await Promise.all(sites.map((s) => runCheck(app, s)));
  const fresh = await sitesFor(app, sites.map((s) => s.id).join(","));
  return { rows: Object.fromEntries(fresh.map((r) => [r.id, String(rowHtml(r))])) };
}

// Status dot: green/red for true/false, muted for unknown (null).
const dot = (v: unknown, title: string): HtmlString => {
  const style = v == null ? "opacity:.3" : `color:var(${v ? "--green" : "--red"})`;
  return html`<span title="${title}" style="${style}">●</span>`;
};

// Sort rank for tri-state dot columns: unknown < offline/bad < online/good.
const rank = (v: unknown) => v == null ? 0 : v ? 2 : 1;

const lines = (v: string): string[] => (v ?? "").split("\n").filter(Boolean);

// Fetch and TLS messages are far too long for a cell — show a label, keep the text in the title.
const errLabels: [RegExp, string][] = [
  [/failed to lookup|dns error/i, "dns not found"],
  [/timed out|timeout|aborted/i, "timeout"],
  [/certificate expired/i, "cert expired"],
  [/not valid for name/i, "cert wrong host"],
  [/unknownissuer|self.?signed/i, "cert untrusted"],
  [/certificate|tls|ssl|handshake/i, "tls error"],
  [/refused/i, "refused"],
  [/unreachable|no route/i, "unreachable"],
  [/reset|closed before|incomplete/i, "connection lost"],
  [/expected text missing/i, "text missing"],
];
const errShort = (msg: string): string => errLabels.find(([re]) => re.test(msg))?.[1] ?? "error";

// One DNS record per line so the same type lines up across rows for comparison.
const dnsCell = (v: string): HtmlString => {
  const list = lines(v);
  return list.length ? html`<small>${html.join(list, "<br>")}</small>` : html`–`;
};

function rowHtml(r: Row): HtmlString {
  const host = (() => { try { return new URL(r.url).hostname; } catch { return r.url; } })();
  const alt = host.startsWith("www.") ? host.slice(4) : "www." + host;
  const nsTotal = lines(r.dns_ns).length;
  const nsOk = nsTotal ? r.ns_in_sync && r.ns_answering === nsTotal : null;
  const nsTitle = !nsTotal ? "no NS records" : `${r.ns_answering ?? 0}/${nsTotal} answering, ${r.ns_in_sync ? "zones in sync" : "zones differ"}`;
  const certLow = r.cert_valid && r.cert_days != null && r.cert_days < 14; // renew now, not later
  const certTitle = r.cert_valid == null ? "no https" : !r.cert_valid ? "cert invalid" : r.cert_days == null ? "cert valid" : `cert valid, ${r.cert_days} days left`;
  const caa = lines(r.dns_caa);
  const spf = lines(r.dns_txt).some((t) => /^v=spf1/i.test(t));
  const dmarc = lines(r.dns_dmarc).length > 0;
  const ipv6Title = !lines(r.dns_aaaa).length ? "no AAAA record" : r.ipv6 == null ? "no IPv6 route from this server" : r.ipv6 ? "answers over IPv6" : "AAAA record, but no answer over IPv6";
  const wwwTitle = r.www_ok == null ? `${alt} has no address` : r.www_ok ? `${alt} is served too` : `${alt} resolves but does not answer`;

  const del = html`<button class=u2-unstyle data-action=delete data-id="${r.id}" u2-confirm="Delete ${host}?"><u2-ico icon=delete>✕</u2-ico></button>`;
  const check = html`<button class=u2-unstyle data-action=check data-id="${r.id}" title="Check now"><u2-ico icon=refresh>↻</u2-ico></button>`;
  const expect = html`<button class=u2-unstyle data-action=expect data-id="${r.id}" data-expect="${r.expect}" title="${r.expect ? `Expected in body: ${r.expect}` : "Expect text in the body"}"><u2-ico icon=edit>✎</u2-ico></button>`;
  return html`<tr data-id="${r.id}">
      <td data-value="${rank(r.online)}">${dot(r.online, r.error || (r.online ? "online" : r.checked ? "offline" : "not checked yet"))}
      <td data-value="${host}"><a href="${r.url}" target=_blank>${host}</a>${r.final_url ? html`<br><small>→ ${r.final_url}</small>` : ""}${r.error ? html`<br><small title="${r.error}">${errShort(r.error)}</small>` : ""}
      <td data-value="${r.status_code}">${r.status_code ?? "–"}
      <td data-value="${r.response_time}">${r.response_time != null ? r.response_time + " ms" : "–"}
      <td data-value="${rank(r.cert_valid) === 1 ? -1 : r.cert_days}">${dot(certLow ? false : r.cert_valid, certTitle)}${r.cert_days != null ? html` <small>${r.cert_days} d</small>` : ""} ${dot(caa.length ? true : null, caa.length ? `CAA: ${caa.join(", ")}` : "no CAA record")}
      <td data-value="${rank(r.redirect_https)}">${dot(r.redirect_https, r.redirect_https == null ? "unknown" : r.redirect_https ? "http→https" : "no https redirect")}
      <td data-value="${rank(r.ipv6)}">${dot(r.ipv6, ipv6Title)}
      <td data-value="${rank(r.www_ok)}">${dot(r.www_ok, wwwTitle)}
      <td data-value="${rank(nsOk)}|${r.dns_ns}">${dot(nsOk, nsTitle)} ${dnsCell(r.dns_ns)}
      <td data-value="${r.dns_a}">${dnsCell(r.dns_a)}
      <td data-value="${r.dns_aaaa}">${dnsCell(r.dns_aaaa)}
      <td data-value="${r.dns_mx}">${dnsCell(r.dns_mx)}
      <td data-value="${rank(spf && dmarc)}|${r.dns_txt}">${dot(spf, spf ? "SPF set" : "no SPF record")}${dot(dmarc, dmarc ? `DMARC: ${lines(r.dns_dmarc).join(" ")}` : "no DMARC record")} ${dnsCell(r.dns_txt)}
      <td data-value="${r.checked ?? 0}">${html.raw(u2time(r.checked))}${r.dns_changed ? html`<br><small title="DNS records changed">Δ ${html.raw(u2time(r.dns_changed))}</small>` : ""}
      <td style="white-space:nowrap">${check}${expect}${del}`;
}

async function render(node: Node, { vars = {} }: { vars?: Record<string, any> } = {}): Promise<HtmlString> {
  const app = node.app;
  const skipped = vars.add ? await addSites(app, String(vars.urls ?? "")) : [];

  const rows: Row[] = await app.db.query`SELECT * FROM monitor_site ORDER BY sort, id`;
  const body = html.join(rows.map(rowHtml), "\n");
  const empty = html`<tr><td colspan="15" style="text-align:center;padding:1em">No sites yet.`;

  return html`<div class="u2-card">
  <div class="-head">Monitor (<span data-monitor-count>${rows.length}</span>)</div>
  <div class="-body" style="display:flex; gap:.5rem; flex-wrap:wrap; align-items:center">
    <input type=search placeholder="search…" data-monitor-search style="width:15rem; max-width:100%">
    <select data-monitor-filter>
      <option value="">all</option>
      <option value="up">online</option>
      <option value="down">offline</option>
    </select>
    <button data-action=checkVisible style="margin-left:auto" title="Check the rows the search and filter leave visible">Check visible</button>
    <button data-action=checkFailed title="Check every site that shows a red mark">Check failed</button>
    <button data-action=checkAll>Check all</button>
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
        <th data-sort-handler width=2>IPv6
        <th data-sort-handler width=2>www
        <th data-sort-handler>NS
        <th data-sort-handler>A
        <th data-sort-handler>AAAA
        <th data-sort-handler>MX
        <th data-sort-handler>TXT
        <th data-sort-handler width=5>Checked
        <th width=1>
      <tbody>${rows.length ? body : empty}
    </table>
  </u2-table>
  <div class="-body" style="display:flex; gap:.5rem; flex-wrap:wrap; align-items:end">
    <label style="flex:1">Add sites <small>(one per line, https optional)</small><br><textarea name=urls rows=3 placeholder="example.com&#10;https://sub.example.org" style="width:100%"></textarea>${
      skipped.length ? html`<small>Skipped, no valid host: ${skipped.join(", ")}</small>` : ""
    }</label>
    <button data-action=add>Add</button>
  </div>
</div>`;
}
