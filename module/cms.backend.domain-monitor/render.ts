import { html, type Ctx, type HtmlString, u2time } from "../core/mod.ts";
import type { Node } from "../cms/mod.ts";
import { wwwAlt } from "./lib/check.ts";
import { addDomains, type CheckFrequency, type DomainRow, parseResult } from "./lib/monitor.ts";

const historyLimit = 500;
const ignoredChanges = new Set(["response_time", "cert_days", "checked", "dns_changed", "log_id", "log_id_ch"]);

// Traffic light. The weight is both the severity and the sort value of the status column.
const levels = { green: 0, blue: 1, gray: 2, orange: 3, red: 4 };
type Level = keyof typeof levels;

const dot = (level: Level, title: string): HtmlString =>
  html`<span title="${title}" style="color:var(--${level});font-size:1.3em;line-height:1">●</span>`;

// Tri-state flag for the boolean columns: unknown stays gray rather than accusing anyone.
const flag = (value: unknown, title: string): HtmlString => dot(value == null ? "gray" : value ? "green" : "red", title);

// Sort rank for tri-state flag columns: unknown < bad < good.
const rank = (value: unknown) => value == null ? 0 : value ? 2 : 1;

// What the last check says about the domain as a whole. An answer is an answer: 401 and 404
// mean the server is up, so they are a warning rather than downtime.
function status(row: DomainRow): { level: Level; title: string } {
  if (!row.checked) return { level: "gray", title: "not checked yet" };
  return checkedStatus(row.online, row.status_code, row.error, row.final_url);
}

function checkedStatus(
  online: boolean | null | undefined,
  code: number | null | undefined,
  error: string | null | undefined,
  finalUrl: string | null | undefined,
): { level: Level; title: string } {
  if (!online) return { level: "red", title: error ? errShort(error) : "no answer" };
  code ??= 0;
  if (code >= 500) return { level: "red", title: `server error ${code}` };
  if (code === 401 || code === 403) return { level: "blue", title: `access restricted, ${code}` };
  if (code >= 400) return { level: "orange", title: `client error ${code}` };
  if (error) return { level: "orange", title: errShort(error) };
  return { level: "green", title: finalUrl ? `forwards to ${finalUrl}` : `online, ${code}` };
}

function flattened(value: unknown, path = "", target = new Map<string, unknown>()): Map<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (ignoredChanges.has(key)) continue;
      flattened(child, path ? `${path}.${key}` : key, target);
    }
  } else target.set(path, value);
  return target;
}

function changeCell(current: unknown, previous: unknown): HtmlString {
  if (!previous) return html`–`;
  const before = flattened(previous);
  const after = flattened(current);
  const keys = new Set([...before.keys(), ...after.keys()]);
  const changed = [...keys].filter((key) => JSON.stringify(before.get(key)) !== JSON.stringify(after.get(key)));
  if (!changed.length) return html`–`;
  return html`<div class=domain-monitor-changes>${html.join(changed.map((key) => html`<div>
    <b>${key}</b>: <del>${changeValue(before.get(key))}</del> → <ins>${changeValue(after.get(key))}</ins>
  </div>`))}</div>`;
}

function changeValue(value: unknown): string {
  if (Array.isArray(value)) return value.length ? value.join(", ") : "[]";
  if (value === "") return '""';
  return String(value);
}

const lines = (value?: string | null): string[] => (value ?? "").split("\n").filter(Boolean);

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
const errShort = (message: string): string => errLabels.find(([regexp]) => regexp.test(message))?.[1] ?? "error";

// One DNS record per line so the same type lines up across rows for comparison.
const dnsCell = (value?: string | null): HtmlString => {
  const list = lines(value);
  return list.length ? html`<small>${html.join(list, "<br>")}</small>` : html`–`;
};

function frequencySelect(row: DomainRow): HtmlString {
  const selected = row.check_frequency ?? "disabled";
  const option = (value: CheckFrequency, label: string) =>
    html`<option value="${value}" ${selected === value ? "selected" : ""}>${label}`;
  return html`<select data-frequency data-domain="${row.domain}" title="Automatic checks">
    ${option("disabled", "off")}${option("hourly", "hourly")}${option("daily", "daily")}
  </select>`;
}

export function rowHtml(row: DomainRow): HtmlString {
  const domain = row.domain;
  const alt = wwwAlt(domain);
  const state = status(row);
  const nsTotal = lines(row.dns_ns).length;
  const nsOk = nsTotal ? row.ns_in_sync && row.ns_answering === nsTotal : null;
  const nsTitle = !nsTotal ? "no NS records" : `${row.ns_answering ?? 0}/${nsTotal} answering, ${row.ns_in_sync ? "zones in sync" : "zones differ"}`;
  const certLow = row.cert_valid && row.cert_days != null && row.cert_days < 14; // renew now, not later
  const certTitle = row.cert_valid == null ? "no answer" : !row.cert_valid ? "cert invalid" : row.cert_days == null ? "cert valid" : `cert valid, ${row.cert_days} days left`;
  const caa = lines(row.dns_caa);
  const spf = lines(row.dns_txt).some((text) => /^v=spf1/i.test(text));
  const dmarc = lines(row.dns_dmarc).length > 0;
  const ipv6Title = !lines(row.dns_aaaa).length ? "no AAAA record" : row.ipv6 == null ? "no IPv6 route from this server" : row.ipv6 ? "answers over IPv6" : "AAAA record, but no answer over IPv6";
  const wwwTitle = row.www_ok == null ? `${alt} has no address` : row.www_ok ? `${alt} is served too` : `${alt} resolves but does not answer`;

  const del = html`<button class=u2-unstyle data-action=delete data-domain="${domain}" u2-confirm="Delete ${domain}?"><u2-ico icon=delete>✕</u2-ico></button>`;
  const check = html`<button class=u2-unstyle data-action=check data-domain="${domain}" title="Check now"><u2-ico icon=refresh>↻</u2-ico></button>`;
  const expect = html`<button class=u2-unstyle data-action=expect data-domain="${domain}" data-expect="${row.expect}" title="${row.expect ? `Expected in body: ${row.expect}` : "Expect text in the body"}"><u2-ico icon=edit>✎</u2-ico></button>`;
  return html`<tr data-domain="${domain}">
      <td data-value="${levels[state.level]}">${dot(state.level, state.title)}
      <td data-value="${domain}"><a href="?domain=${encodeURIComponent(domain)}">${domain}</a> <a href="https://${domain}/" target=_blank title="Open website">↗</a>${row.final_url ? html`<br><small>→ ${row.final_url}</small>` : ""}${row.error ? html`<br><small title="${row.error}">${errShort(row.error)}</small>` : ""}
      <td data-value="${row.status_code}">${row.status_code ?? "–"}
      <td data-value="${row.response_time}">${row.response_time != null ? row.response_time + " ms" : "–"}
      <td data-value="${rank(row.cert_valid) === 1 ? -1 : row.cert_days}">${flag(certLow ? false : row.cert_valid, certTitle)}${row.cert_days != null ? html` <small>${row.cert_days} d</small>` : ""} ${flag(caa.length ? true : null, caa.length ? `CAA: ${caa.join(", ")}` : "no CAA record")}
      <td data-value="${rank(row.redirect_https)}">${flag(row.redirect_https, row.redirect_https == null ? "unknown" : row.redirect_https ? "http→https" : "no https redirect")}
      <td data-value="${rank(row.ipv6)}">${flag(row.ipv6, ipv6Title)}
      <td data-value="${rank(row.www_ok)}">${flag(row.www_ok, wwwTitle)}
      <td data-value="${rank(nsOk)}|${row.dns_ns}">${flag(nsOk, nsTitle)} ${dnsCell(row.dns_ns)}
      <td data-value="${row.dns_a}">${dnsCell(row.dns_a)}
      <td data-value="${row.dns_aaaa}">${dnsCell(row.dns_aaaa)}
      <td data-value="${row.dns_mx}">${dnsCell(row.dns_mx)}
      <td data-value="${rank(spf && dmarc)}|${row.dns_txt}">${flag(spf, spf ? "SPF set" : "no SPF record")}${flag(dmarc, dmarc ? `DMARC: ${lines(row.dns_dmarc).join(" ")}` : "no DMARC record")} ${dnsCell(row.dns_txt)}
      <td data-value="${row.checked ?? 0}">${html.raw(u2time(row.checked))}${row.dns_changed ? html`<br><small title="DNS records changed">Δ ${html.raw(u2time(row.dns_changed))}</small>` : ""}
      <td>${frequencySelect(row)}
      <td style="white-space:nowrap">${check}${expect}${del}`;
}

async function renderDetail(node: Node, ctx: Ctx, domain: string): Promise<HtmlString> {
  const row = await node.app.db.row<DomainRow>`SELECT * FROM monitor_domain WHERE domain = ${domain}`;
  const back = ctx.req.url.toURL();
  back.searchParams.delete("domain");
  if (!row) return html`<div class=u2-card><div class=-head>Domain monitor</div><div class=-body>
    <a href="${back.search || "?"}">← Domains</a><p>Domain not found.</div></div>`;

  const checks = await node.app.db.query<{ id: number; checked_at: number; result: string }>`
    SELECT id, checked_at, result FROM monitor_domain_check
    WHERE domain = ${domain} ORDER BY checked_at DESC LIMIT ${historyLimit}`;
  const current = status(row);
  const results = checks.map((check) => parseResult(check.result));
  const history = checks.map((check, index) => {
    const result = results[index];
    if (!result) return html`<tr><td>${html.raw(u2time(check.checked_at))}<td colspan=8>Invalid result data`;
    const state = checkedStatus(result.online, result.status_code, result.error, result.final_url);
    const cert = result.cert_valid == null ? "–" : result.cert_valid ? `${result.cert_days ?? "?"} d` : "invalid";
    return html`<tr>
      <td>${html.raw(u2time(check.checked_at))}
      <td>${dot(state.level, state.title)} ${state.title}
      <td>${changeCell(result, results[index + 1])}
      <td>${result.status_code ?? "–"}
      <td>${result.response_time != null ? `${result.response_time} ms` : "–"}
      <td>${cert}
      <td>${flag(result.redirect_https, "HTTPS redirect")}
      <td>${flag(result.ipv6, "IPv6")}
      <td><details><summary>Data</summary><pre>${JSON.stringify(result, null, 2)}</pre></details>`;
  });

  const check = html`<button data-action=check data-domain="${domain}">Check now</button>`;
  const expect = html`<button data-action=expect data-domain="${domain}" data-expect="${row.expect}">Expected text</button>`;
  return html`<div class="u2-flex domain-monitor-detail">
    <div class="u2-card" style="flex:1 1 20rem">
      <div class=-head><a href="${back.search || "?"}">← Domains</a> · ${domain}</div>
      <div class=-body>
        <p>${dot(current.level, current.title)} <b>${current.title}</b></p>
        <p>${check} ${expect} ${frequencySelect(row)} <a href="https://${domain}/" target=_blank>Open website ↗</a></p>
      </div>
      <table class=u2-table>
        <tr><th>Last checked<td>${html.raw(u2time(row.checked))}
        <tr><th>Status code<td>${row.status_code ?? "–"}
        <tr><th>Response time<td>${row.response_time != null ? `${row.response_time} ms` : "–"}
        <tr><th>Final URL<td>${row.final_url ?? "–"}
        <tr><th>Certificate<td>${row.cert_valid == null ? "–" : row.cert_valid ? `${row.cert_days ?? "?"} days remaining` : "invalid"}
        <tr><th>Expected text<td>${row.expect || "–"}
      </table>
    </div>
    <div class="u2-card -full" style="flex:2 1 50rem">
      <div class=-head>Check history (${checks.length}${checks.length === historyLimit ? "+" : ""})</div>
      <div class=domain-monitor-history>
        <table class="u2-table -Sticky">
          <thead><tr><th>Checked<th>Result<th>Changes<th>Code<th>Time<th>Cert<th>HTTPS<th>IPv6<th>
          <tbody>${history.length ? html.join(history) : html`<tr><td colspan=9>No checks yet.`}
        </table>
      </div>
    </div>
  </div>`;
}

export async function render(node: Node, { ctx, vars = {} }: { ctx: Ctx; vars?: Record<string, unknown> }): Promise<HtmlString> {
  const domain = String(ctx.req.query.domain ?? "");
  if (domain) return renderDetail(node, ctx, domain);

  const app = node.app;
  const skipped = vars.add ? await addDomains(app, String(vars.domains ?? "")) : [];
  const rows = await app.db.query<DomainRow>`SELECT * FROM monitor_domain ORDER BY sort, domain`;
  const body = html.join(rows.map(rowHtml), "\n");
  const empty = html`<tr><td colspan="16" style="text-align:center;padding:1em">No domains yet.`;

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
        <th data-sort-handler>Automatic
        <th width=1>
      <tbody data-monitor-list>${rows.length ? body : empty}
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
