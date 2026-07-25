import dbSchema from "./dbschema.json" with { type: "json" };
import { html, type HtmlString, sql, u2time, unixTime, type App } from "../core/mod.ts";
import { cms as getCms, type Node } from "../cms/mod.ts";
import { backend } from "../cms.backend/mod.ts";
import { apex, checkDomain, wwwAlt } from "./lib/check.ts";

export const name = "cms.backend.domain-monitor";
export const needs = ["cms.backend"];
export { dbSchema };
export const cms = { node: { js: ["pub/main.js"], render, api } };

export async function install({ app }: { app: App }): Promise<void> {
  const cm = getCms(app);
  const old = await cm.nodeByModule("cms.backend.monitor");
  if (old && !await cm.nodeByModule(name)) await old.set("module", name);
  await migrateSites(app);
  await backend.install(app, name, { en: "Domain monitor", de: "Domain-Überwachung" });
}

type Row = Record<string, any>;

const table = (app: App) => app.db.table("monitor_domain");

// A pasted entry is reduced to its host: scheme and path are dropped, everything that is not
// a plausible domain — other schemes, bare words, userinfo, bare IPs — returns "".
const normalizeDomain = (s: string): string => {
  s = s.trim();
  if (!s) return "";
  const scheme = s.match(/^([a-z][a-z0-9+.-]*):\/\//i)?.[1].toLowerCase();
  if (scheme && scheme !== "http" && scheme !== "https") return "";
  try {
    const u = new URL(scheme ? s : "https://" + s);
    if (u.username || u.password) return "";
    return u.hostname.length <= 191 && /^([a-z0-9](-*[a-z0-9])*\.)+([a-z]{2,}|xn--[a-z0-9-]+)$/i.test(u.hostname) ? u.hostname : ""; // labels + real TLD
  } catch { return ""; }
};

// Move entries from the former URL-based table once. Successfully converted rows are removed
// so a deliberately deleted domain cannot reappear on the next start.
async function migrateSites(app: App): Promise<void> {
  const source = app.db.tables.monitor_site;
  if (!source?.field("url")) return;
  const rows: Row[] = await app.db.query`SELECT * FROM ${sql.id(source)} ORDER BY ${sql.id("id")}`;
  if (!rows.length) return;
  const target = table(app);
  await app.db.transaction(async () => {
    for (const row of rows) {
      const domain = normalizeDomain(String(row.url ?? ""));
      if (!domain) continue;
      const { id, url: _url, ...values } = row;
      if (!await target.selectByID(domain)) await target.insert({ ...values, domain });
      await app.db.exec`DELETE FROM ${sql.id(source)} WHERE ${sql.id("id")} = ${id}`;
    }
  });
}

async function runCheck(app: App, row: Row): Promise<void> {
  const r = await checkDomain(row.domain, row.expect);
  const dns: Row = {};
  for (const [k, list] of Object.entries(r.dns)) dns["dns_" + k] = list.join("\n");
  // remember when a record set last moved — silent DNS changes are worth noticing
  const changed = Object.entries(dns).some(([k, v]) => row[k] != null && row[k] !== v);
  await table(app).update(row.domain, {
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
    dns_changed: changed ? unixTime() : row.dns_changed ?? null,
    error: r.error,
    checked: unixTime(),
  });
}

// The pasted list arrives as `vars` from cms.reloadNode (background apt POST, no full reload).
// Returns the entries that were no usable domain, so the form can name them.
async function addDomains(app: App, list: string): Promise<string[]> {
  const added: string[] = [];
  const skipped: string[] = [];
  for (const raw of new Set(list.split(/[\s,]+/).filter(Boolean))) {
    const domain = normalizeDomain(raw);
    if (!domain) { skipped.push(raw); continue; }
    if (await app.db.one`SELECT domain FROM monitor_domain WHERE domain = ${domain}`) continue; // skip duplicates
    await table(app).insert({ domain, created: unixTime() });
    added.push(domain);
  }
  await Promise.all(added.map((domain) => runCheck(app, { domain })));
  return skipped;
}

// Which rows a check covers: everything, everything with a problem, or an explicit domain list.
// "all" and "problem" can never collide with a domain — a domain always has a dot.
async function rowsFor(app: App, scope: string): Promise<Row[]> {
  const db = app.db;
  if (scope === "all") return await db.query`SELECT * FROM monitor_domain`;
  if (scope === "problem") {
    return await db.query`SELECT * FROM monitor_domain
      WHERE checked IS NULL OR error IS NOT NULL OR online = ${false} OR status_code >= 400
        OR cert_valid = ${false} OR cert_days < 14 OR redirect_https = ${false}
        OR ipv6 = ${false} OR www_ok = ${false} OR ns_in_sync = ${false}`;
  }
  const list = scope.split(",").filter(Boolean);
  if (!list.length) return [];
  return await db.query`SELECT * FROM monitor_domain WHERE domain IN (${sql.join(list.map((d) => sql`${d}`), ",")})`;
}

// Row-level mutations: return JSON so the client updates in place, keeping search/sort state.
async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  const app = node.app;
  if (vars.delete) {
    await table(app).delete(String(vars.delete));
    return { done: true };
  }
  if (vars.expect) await table(app).update(String(vars.expect), { expect: String(vars.value ?? "") });
  const scope = String(vars.check ?? vars.expect ?? "");
  if (!scope) return false;
  const rows = await rowsFor(app, scope);
  await Promise.all(rows.map((r) => runCheck(app, r)));
  const fresh = await rowsFor(app, rows.map((r) => r.domain).join(","));
  return { rows: Object.fromEntries(fresh.map((r) => [r.domain, String(rowHtml(r))])) };
}

// Traffic light. The weight is both the severity and the sort value of the status column.
const levels = { green: 0, blue: 1, gray: 2, orange: 3, red: 4 };
type Level = keyof typeof levels;

const dot = (level: Level, title: string): HtmlString => html`<span title="${title}" style="color:var(--${level})">●</span>`;

// Tri-state flag for the boolean columns: unknown stays gray rather than accusing anyone.
const flag = (v: unknown, title: string): HtmlString => dot(v == null ? "gray" : v ? "green" : "red", title);

// Sort rank for tri-state flag columns: unknown < bad < good.
const rank = (v: unknown) => v == null ? 0 : v ? 2 : 1;

const hostOf = (url: string): string => { try { return new URL(url).hostname; } catch { return ""; } };

// What the last check says about the domain as a whole. An answer is an answer: 401 and 404
// mean the server is up, so they are a warning rather than downtime.
function status(r: Row): { level: Level; title: string } {
  if (!r.checked) return { level: "gray", title: "not checked yet" };
  if (!r.online) return { level: "red", title: r.error ? errShort(r.error) : "no answer" };
  const code = r.status_code ?? 0;
  if (code >= 500) return { level: "red", title: `server error ${code}` };
  if (code >= 400) return { level: "orange", title: `client error ${code}` };
  if (r.error) return { level: "orange", title: errShort(r.error) };
  // a redirect within the own domain (apex ↔ www, language paths) is normal, leaving it is news
  const to = r.final_url ? hostOf(r.final_url) : "";
  if (to && apex(to) !== apex(r.domain)) return { level: "blue", title: `forwards to ${r.final_url}` };
  return { level: "green", title: `online, ${code}` };
}

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
  const domain = r.domain;
  const alt = wwwAlt(domain);
  const st = status(r);
  const nsTotal = lines(r.dns_ns).length;
  const nsOk = nsTotal ? r.ns_in_sync && r.ns_answering === nsTotal : null;
  const nsTitle = !nsTotal ? "no NS records" : `${r.ns_answering ?? 0}/${nsTotal} answering, ${r.ns_in_sync ? "zones in sync" : "zones differ"}`;
  const certLow = r.cert_valid && r.cert_days != null && r.cert_days < 14; // renew now, not later
  const certTitle = r.cert_valid == null ? "no answer" : !r.cert_valid ? "cert invalid" : r.cert_days == null ? "cert valid" : `cert valid, ${r.cert_days} days left`;
  const caa = lines(r.dns_caa);
  const spf = lines(r.dns_txt).some((t) => /^v=spf1/i.test(t));
  const dmarc = lines(r.dns_dmarc).length > 0;
  const ipv6Title = !lines(r.dns_aaaa).length ? "no AAAA record" : r.ipv6 == null ? "no IPv6 route from this server" : r.ipv6 ? "answers over IPv6" : "AAAA record, but no answer over IPv6";
  const wwwTitle = r.www_ok == null ? `${alt} has no address` : r.www_ok ? `${alt} is served too` : `${alt} resolves but does not answer`;

  const del = html`<button class=u2-unstyle data-action=delete data-domain="${domain}" u2-confirm="Delete ${domain}?"><u2-ico icon=delete>✕</u2-ico></button>`;
  const check = html`<button class=u2-unstyle data-action=check data-domain="${domain}" title="Check now"><u2-ico icon=refresh>↻</u2-ico></button>`;
  const expect = html`<button class=u2-unstyle data-action=expect data-domain="${domain}" data-expect="${r.expect}" title="${r.expect ? `Expected in body: ${r.expect}` : "Expect text in the body"}"><u2-ico icon=edit>✎</u2-ico></button>`;
  return html`<tr data-domain="${domain}">
      <td data-value="${levels[st.level]}">${dot(st.level, st.title)}
      <td data-value="${domain}"><a href="https://${domain}/" target=_blank>${domain}</a>${r.final_url ? html`<br><small>→ ${r.final_url}</small>` : ""}${r.error ? html`<br><small title="${r.error}">${errShort(r.error)}</small>` : ""}
      <td data-value="${r.status_code}">${r.status_code ?? "–"}
      <td data-value="${r.response_time}">${r.response_time != null ? r.response_time + " ms" : "–"}
      <td data-value="${rank(r.cert_valid) === 1 ? -1 : r.cert_days}">${flag(certLow ? false : r.cert_valid, certTitle)}${r.cert_days != null ? html` <small>${r.cert_days} d</small>` : ""} ${flag(caa.length ? true : null, caa.length ? `CAA: ${caa.join(", ")}` : "no CAA record")}
      <td data-value="${rank(r.redirect_https)}">${flag(r.redirect_https, r.redirect_https == null ? "unknown" : r.redirect_https ? "http→https" : "no https redirect")}
      <td data-value="${rank(r.ipv6)}">${flag(r.ipv6, ipv6Title)}
      <td data-value="${rank(r.www_ok)}">${flag(r.www_ok, wwwTitle)}
      <td data-value="${rank(nsOk)}|${r.dns_ns}">${flag(nsOk, nsTitle)} ${dnsCell(r.dns_ns)}
      <td data-value="${r.dns_a}">${dnsCell(r.dns_a)}
      <td data-value="${r.dns_aaaa}">${dnsCell(r.dns_aaaa)}
      <td data-value="${r.dns_mx}">${dnsCell(r.dns_mx)}
      <td data-value="${rank(spf && dmarc)}|${r.dns_txt}">${flag(spf, spf ? "SPF set" : "no SPF record")}${flag(dmarc, dmarc ? `DMARC: ${lines(r.dns_dmarc).join(" ")}` : "no DMARC record")} ${dnsCell(r.dns_txt)}
      <td data-value="${r.checked ?? 0}">${html.raw(u2time(r.checked))}${r.dns_changed ? html`<br><small title="DNS records changed">Δ ${html.raw(u2time(r.dns_changed))}</small>` : ""}
      <td style="white-space:nowrap">${check}${expect}${del}`;
}

async function render(node: Node, { vars = {} }: { vars?: Record<string, any> } = {}): Promise<HtmlString> {
  const app = node.app;
  const skipped = vars.add ? await addDomains(app, String(vars.domains ?? "")) : [];

  const rows: Row[] = await app.db.query`SELECT * FROM monitor_domain ORDER BY sort, domain`;
  const body = html.join(rows.map(rowHtml), "\n");
  const empty = html`<tr><td colspan="15" style="text-align:center;padding:1em">No domains yet.`;

  return html`<div class="u2-card">
  <div class="-head">Domain monitor (<span data-monitor-count>${rows.length}</span>)</div>
  <div class="-body" style="display:flex; gap:.5rem; flex-wrap:wrap; align-items:center">
    <input type=search placeholder="search…" data-monitor-search style="width:15rem; max-width:100%">
    <select data-monitor-filter>
      <option value="">all</option>
      <option value="ok">ok</option>
      <option value="problem">problems</option>
    </select>
    <button data-action=checkVisible style="margin-left:auto" title="Check the rows the search and filter leave visible">Check visible</button>
    <button data-action=checkProblems title="Check every domain that shows a problem">Check problems</button>
    <button data-action=checkAll>Check all</button>
  </div>
  <u2-table style="padding:0; max-height:85vh; overflow:auto">
    <table class="u2-table -Sticky" style="white-space:nowrap;">
      <thead><tr>
        <th data-sort-handler width=2>Status
        <th data-sort-handler>Domain
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
    <label style="flex:1">Add domains <small>(one per line)</small><br><textarea name=domains rows=3 placeholder="example.com&#10;sub.example.org" style="width:100%"></textarea>${
      skipped.length ? html`<small>Skipped, no valid domain: ${skipped.join(", ")}</small>` : ""
    }</label>
    <button data-action=add>Add</button>
  </div>
</div>`;
}
