import { getCtx, html, type App, type Ctx, type HtmlString } from "../core/mod.ts";
import { u2 } from "../cms.backend/mod.ts";
import type { Node } from "../cms/mod.ts";
import { wwwAlt } from "./lib/check.ts";
import { diffResults } from "./lib/changes.ts";
import { addDomains, frequencies, type DomainRow, parseResult } from "./lib/monitor.ts";

const HISTORY_LIMIT = 500;
const DAY = 24 * 60 * 60;

// Optional column groups. The table carries a "-no-<name>" class per hidden group, so toggling one
// is a single class change instead of a walk over every cell.
const GROUPS = ["http", "tls", "dns", "mail"] as const;
type Group = typeof GROUPS[number];
const GROUP_LABELS: Record<Group, string> = { http: "HTTP", tls: "TLS", dns: "DNS", mail: "Mail" };

// Traffic light. The weight is both the severity and the sort value of the status column.
const LEVELS = { green: 0, blue: 1, gray: 2, orange: 3, red: 4 };
type Level = keyof typeof LEVELS;

const dot = (level: Level, title: string): HtmlString =>
  html`<span title="${title}" style="color:var(--${level});font-size:1.3em;line-height:1">●</span>`;

// Tri-state flag for the boolean columns: unknown stays gray rather than accusing anyone.
const flag = (value: unknown, title: string): HtmlString => dot(value == null ? "gray" : value ? "green" : "red", title);

// Sort rank for tri-state flag columns: unknown < bad < good.
const rank = (value: unknown) => value == null ? 0 : value ? 2 : 1;

// "Checked, and it is not so" — never `=== false`: boolean columns come back from the driver as
// 1/0 rather than as real booleans, so null is the only thing that means "nothing is known".
const no = (value: unknown): boolean => value != null && !value;

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

function changeCell(current: unknown, previous: unknown): HtmlString {
  const changes = diffResults(previous, current);
  if (!changes.length) return html`–`;
  return html`<div class=-changes>${html.join(changes.map((change) => html`<div>
    <b>${change.key}</b>: <del>${changeValue(change.before)}</del> → <ins>${changeValue(change.after)}</ins>
  </div>`))}</div>`;
}

function changeValue(value: unknown): string {
  if (Array.isArray(value)) return value.length ? value.join(", ") : "[]";
  if (value === "") return '""';
  return String(value);
}

const fact = (label: string, value: HtmlString | string | number): HtmlString => html`<tr><th>${label}<td>${value}`;

const factGroup = (title: string, rows: HtmlString[]): HtmlString => html`<tbody>
  <tr><th colspan=2 class=-group>${title}
  ${html.join(rows)}`;

// Dot plus word — a bare dot is readable in the overview table, but too cryptic on its own.
const state = (value: unknown, title: string): HtmlString =>
  html`${flag(value, title)} ${value == null ? "unknown" : value ? "yes" : "no"}`;

// The dns_* columns store one record per line.
const records = (value?: string | null): HtmlString =>
  value ? html.join(value.split("\n").filter(Boolean).map((v) => html`<div>${v}</div>`)) : html`–`;

const time = (value?: number | null, fallback = "–"): HtmlString => value ? u2.time(value) : html`${fallback}`;

const lines = (value?: string | null): string[] => (value ?? "").split("\n").filter(Boolean);

// Fetch and TLS messages are far too long for a cell — show a label, keep the text in the title.
const ERR_LABELS: [RegExp, string][] = [
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
const errShort = (message: string): string => ERR_LABELS.find(([regexp]) => regexp.test(message))?.[1] ?? "error";

// One DNS record per line so the same type lines up across rows for comparison.
const dnsCell = (value?: string | null): HtmlString => {
  const list = lines(value);
  return list.length ? html`<small>${html.join(list, "<br>")}</small>` : html`–`;
};

// TXT records share no syntax, so the badge takes whatever names the record: the key of a
// "key=value" record, the scheme behind "v=", the vendor prefix of a token — "token" when
// nothing in it names anything, which is what most verification strings look like.
// Records write their names in every casing there is, so the label ends up lowercase throughout.
function txtLabel(record: string): string {
  const value = record.trim();
  const eq = value.indexOf("=");
  const key = eq > 0 ? value.slice(0, eq) : "";
  const first = value.split(/\s/)[0];
  const label = key === "v"
    ? value.slice(eq + 1).split(/[\s;]/)[0].replace(/v?\d+$/i, "") || "?"
    // "google-site-verification", "apple-domain-verification" and friends all say the same thing twice
    : key && !/\s/.test(key)
    ? key.replace(/[-_]?(?:domain|site|dns|host)?[-_]?verification$/i, "") || key
    : /^[a-z]{2,8}-/i.test(first)
    ? first.split("-")[0]
    : first && first.length <= 12
    ? first
    : "token";
  return label.slice(0, 12).toLowerCase();
}

// Records that end up under the same label share one badge — a domain with four verification
// strings would otherwise widen the column with four identical ones.
const txtGroups = (value?: string | null): [string, string[]][] => [...Map.groupBy(lines(value), txtLabel)];

const txtCell = (groups: [string, string[]][]): HtmlString =>
  groups.length
    ? html`<div class=-txt>${
      html.join(
        groups.map(([label, records]) => html`<small class=u2-badge title="${records.join("\n")}">${label}${records.length > 1 ? ` ${records.length}` : ""}</small>`),
        " ",
      )
    }</div>`
    : html`–`;

const bare = (name: string) => name.replace(/\.$/, "");

// What each nameserver answered, as recorded by the check: "<name> <ip> <serial> <primary> <ns,ns>",
// the bare name alone when it stayed silent. Everything below is read out of these lines.
type NsServer = { name: string; ip: string; serial: string; primary: string; zone: string[] };

const nsServers = (row: DomainRow): NsServer[] => lines(row.ns_servers).map((line) => {
  const [name, ip = "", serial = "", primary = "", zone = ""] = line.split(" ");
  return { name, ip, serial, primary, zone: zone.split(",").filter(Boolean) };
});

// Serials only compare per primary: two providers (say Route53 + NS1) run their own numbering, but
// every server behind one primary must have received the same zone version. An empty NS set counts
// as "did not say" rather than as drift.
function nsInSync(list: NsServer[]): boolean {
  const zones = new Set(list.map((s) => s.zone.join(",")).filter(Boolean));
  const groups = [...Map.groupBy(list, (s) => s.primary).values()];
  return zones.size <= 1 && groups.every((g) => new Set(g.map((s) => s.serial)).size === 1);
}

// Long names would push the column wide; the tail carries the zone, which is what tells them apart.
const shorten = (name: string) => name.length > 33 ? name.slice(0, 6) + "…" + name.slice(-24) : name;

// The parent's delegation against the NS set the zone itself serves — null while either is unknown.
function nsParentMatch(row: DomainRow, answering: NsServer[]): boolean | null {
  const parent = lines(row.dns_ns_parent).map(bare).sort().join(",");
  const zone = answering.find((s) => s.zone.length)?.zone.map(bare).sort().join(",") ?? "";
  return parent && zone ? parent === zone : null;
}

function nsState(row: DomainRow) {
  const list = nsServers(row);
  const answering = list.filter((s) => s.ip);
  const sync = nsInSync(answering);
  const parent = nsParentMatch(row, answering);
  // Four nameservers in one /24 fall over together — that is one nameserver wearing four hats.
  const subnets = new Set(answering.map((s) => s.ip.split(".").slice(0, 3).join("."))).size;
  return { list, answering, sync, parent, subnets, ok: list.length ? answering.length === list.length && sync && !no(parent) : null };
}

// One line per nameserver, because a single dot cannot say which of them is the broken one:
// red is a server that never answered, orange means the answering ones serve different zones.
function nsCell(row: DomainRow, ns: ReturnType<typeof nsState>): HtmlString {
  const names = ns.list.length ? ns.list.map((s) => s.name) : lines(row.dns_ns).map(bare);
  if (!names.length) return html`${dot("gray", "no NS records")}`;
  const line = (name: string): HtmlString => {
    const server = ns.list.find((s) => s.name === name);
    const [level, title]: [Level, string] = !server
      ? ["gray", "not checked"]
      : !server.ip
      ? ["red", "does not answer"]
      : ns.sync
      ? ["green", `${server.ip}, zone in sync`]
      : ["orange", `${server.ip}, but the zones differ`];
    return html`<div>${dot(level, title)} <small title="${name}">${shorten(name)}</small></div>`;
  };
  // Whole-delegation faults belong to no single server, so they get a line of their own.
  const faults: [string, string][] = [];
  if (ns.answering.length > 1 && ns.subnets < 2) faults.push(["one /24", "all nameservers sit in the same /24 and fall over together"]);
  if (no(ns.parent)) faults.push(["parent differs", "the delegation at the parent differs from the NS set in the zone"]);
  return html`${html.join(names.map(line))}${html.join(faults.map(([short, title]) => html`<div>${dot("orange", title)} <small>${short}</small></div>`))}`;
}

// A short TTL is a moving-house setting: right for the day of a migration, a liability every other
// day, because it forces every resolver on earth to ask again that often.
const ttlLevel = (seconds: number): Level => seconds < 60 ? "red" : seconds < 300 ? "orange" : "green";

function ttlCell(row: DomainRow): HtmlString {
  const list = lines(row.dns_ttl).map((line) => line.split("="));
  const seconds = list.map(([, value]) => Number(value)).filter((n) => n > 0);
  if (!seconds.length) return html`–`;
  const low = Math.min(...seconds);
  return html`${dot(ttlLevel(low), list.map(([type, value]) => `${type.toUpperCase()} ${value}s`).join(", "))} <small>${low}s</small>`;
}

// The registration outliving the certificate is not a given, and this deadline takes the whole
// domain down rather than one service. Many ccTLDs publish no RDAP at all, hence the blank.
function expiresCell(row: DomainRow): HtmlString {
  if (no(row.reg_found)) return html`${dot("red", "the registry does not know this domain")} <small>gone</small>`;
  if (!row.reg_expires) return html`–`;
  const days = Math.floor((row.reg_expires * 1000 - Date.now()) / 86400000);
  const on = new Date(row.reg_expires * 1000).toISOString().slice(0, 10);
  const title = `expires ${on}${row.reg_registrar ? ", " + row.reg_registrar : ""}${row.reg_locked ? ", transfer locked" : ""}`;
  return html`${dot(days < 14 ? "red" : days < 45 ? "orange" : "green", title)} <small>${days} d</small>`;
}

// A change is news rather than a fault, so the marker fades with age instead of ranking severity:
// the fields the last check found different are named in the title.
function changedCell(row: DomainRow): HtmlString {
  if (!row.changed) return html`–`;
  const age = Date.now() / 1000 - row.changed;
  const fields = lines(row.changes);
  const title = fields.length ? `changed: ${fields.join(", ")}` : "changed";
  const mark = age < DAY ? dot("red", title) : age < 7 * DAY ? dot("orange", title) : html``;
  return html`${mark} <small title="${title}">${u2.time(row.changed, { narrow: true })}</small>`;
}

function headersCell(row: DomainRow): HtmlString {
  const missing = lines((row.headers_missing ?? "").replace(/, /g, "\n"));
  const hsts = row.hsts ?? 0;
  const title = [
    hsts ? `HSTS ${Math.round(hsts / 86400)} days${row.hsts_flags ? ` (${row.hsts_flags})` : ""}` : "no HSTS",
    missing.length ? "missing: " + missing.join(", ") : "all present",
  ].join(" · ");
  return html`${dot(row.hsts == null ? "gray" : !hsts || missing.length ? "orange" : "green", title)}${missing.length ? html` <small>${missing.length}</small>` : ""}`;
}

// Not being signed is the norm rather than a fault, so unsigned stays neutral. A DS at the parent
// with no key behind it is the one alarming case — that breaks the domain for validating resolvers.
function dnssecCell(row: DomainRow): HtmlString {
  if (row.dnssec) return dot("green", "signed and delegated");
  if (no(row.dnssec)) return dot("gray", "not signed");
  return dot(row.dns_ds ? "orange" : "gray", row.dns_ds ? "DS at the parent, but no key found in the zone" : "unknown");
}

function spfCell(row: DomainRow): HtmlString {
  if (!row.spf) return html`${dot("gray", "no SPF record")}`;
  const lookups = row.spf_lookups ?? 0;
  const policy = row.spf_policy ?? "";
  // Past ten lookups a receiver stops evaluating and the whole record turns into a permerror.
  const level: Level = row.spf_error || lookups > 10 ? "red" : policy === "-all" || policy === "~all" ? "green" : "orange";
  const title = [row.spf_error, `${policy || "no all mechanism"}, ${lookups}/10 lookups`].filter(Boolean).join(" · ");
  return html`${dot(level, title)} <small>${policy || "?"}</small>`;
}

function dmarcCell(row: DomainRow): HtmlString {
  const policy = row.dmarc_policy ?? "";
  if (!policy) return html`${dot("gray", "no DMARC record")}`;
  const pct = row.dmarc_pct ?? 100;
  const title = `p=${policy}${row.dmarc_sub ? `, sp=${row.dmarc_sub}` : ""}, pct=${pct}${row.dmarc_rua ? ", reports on" : ", no reports"}`;
  // p=none only watches, and a pct below 100 exempts the rest of the mail from whatever it says.
  const level: Level = policy === "none" ? "orange" : pct < 100 ? "orange" : "green";
  return html`${dot(level, title)} <small>${policy}</small>`;
}

function smtpCell(row: DomainRow): HtmlString {
  if (row.mail_null_mx) return html`${dot("gray", "null MX — this domain receives no mail on purpose")} <small>none</small>`;
  if (!lines(row.mail_hosts).length) return html`${dot("gray", "no MX record")}`;
  const dane = lines(row.mail_dane).length > 0;
  const level: Level = no(row.mail_hosts_ok) || no(row.mail_tls_valid) ? "red"
    : no(row.mail_starttls) ? "orange"
    : row.mail_starttls == null ? "gray"
    : "green";
  const title = [
    no(row.mail_hosts_ok) ? "an MX host does not resolve" : "",
    row.mail_starttls == null ? "port 25 not reachable from this server" : row.mail_starttls ? "STARTTLS offered" : "no STARTTLS",
    no(row.mail_tls_valid) ? "mail certificate invalid" : "",
    dane ? "DANE published" : "",
  ].filter(Boolean).join(", ");
  return html`${dot(level, title)}${dane ? html` <small title=DANE>DANE</small>` : ""}`;
}

// Options come from the frequency list itself, so the select cannot drift from the schema enum.
function frequencySelect(row: DomainRow): HtmlString {
  const selected = row.check_frequency ?? "disabled";
  return html`<select data-frequency data-domain="${row.domain}" title="Automatic checks">${
    html.join(frequencies.map((value) => html`<option value="${value}" ${selected === value ? "selected" : ""}>${value === "disabled" ? "off" : value}`))
  }</select>`;
}

/** The page the table lives on. Taken from the node, not from the request: an api call that
 *  re-renders a row runs on the api url and would build the links against that. */
export const nodeUrl = async (node: Node, ctx: Ctx): Promise<URL> => new URL(await node.url(), ctx.req.url.href);

// Same page, one parameter more — a bare "?domain=…" would drop cmspid, lang and editmode.
const detailLink = (pageUrl: URL, domain: string): string => {
  const url = new URL(pageUrl);
  url.searchParams.set("domain", domain);
  return url.pathname + url.search;
};

export function rowHtml(row: DomainRow, pageUrl: URL): HtmlString {
  const domain = row.domain;
  const alt = wwwAlt(domain);
  const state = status(row);
  const ns = nsState(row);
  const certLow = row.cert_valid && row.cert_days != null && row.cert_days < 14; // renew now, not later
  const certTitle = [
    row.cert_valid == null ? "no answer" : !row.cert_valid ? "cert invalid" : row.cert_days == null ? "cert valid" : `cert valid, ${row.cert_days} days left`,
    row.cert_issuer,
    no(row.cert_names_ok) ? `certificate does not cover ${domain}` : "",
  ].filter(Boolean).join(" · ");
  const caa = lines(row.dns_caa);
  const aaaa = lines(row.dns_aaaa);
  const ipv6Title = !aaaa.length ? "no AAAA record" :row.ipv6 == null ? "no IPv6 route from this server" : row.ipv6 ? "answers over IPv6" : "AAAA record, but no answer over IPv6";
  const wwwTitle = row.www_ok == null ? `${alt} has no address` : row.www_ok ? `${alt} is served too` : `${alt} resolves but does not answer`;

  const dkim = lines(row.dkim);
  const txt = txtGroups(row.dns_txt);
  return html`<tr data-domain="${domain}" u2-href>
      <td><input type=checkbox data-select title="Select for bulk actions">
      <td data-value="${LEVELS[state.level]}">${dot(state.level, state.title)}
      <td data-value="${domain}"><a href="${detailLink(pageUrl, domain)}">${domain}</a> <a href="https://${domain}/" target=_blank title="Open website">↗</a>${row.final_url ? html`<br><small>→ ${row.final_url}</small>` : ""}${row.error ? html`<br><small title="${row.error}">${errShort(row.error)}</small>` : ""}
      <td data-changed data-value="${row.changed ?? 0}">${changedCell(row)}
      <td data-value="${row.reg_expires ?? 0}">${expiresCell(row)}
      <td data-g=http data-value="${row.status_code}">${row.status_code ?? "–"}
      <td data-g=http data-value="${row.response_time}">${row.response_time != null ? row.response_time + " ms" : "–"}
      <td data-g=http data-value="${rank(row.redirect_https)}">${flag(row.redirect_https, row.redirect_https == null ? "unknown" : row.redirect_https ? "http→https" : "no https redirect")}
      <td data-g=http data-value="${row.hsts == null ? -1 : lines((row.headers_missing ?? "").replace(/, /g, "\n")).length}">${headersCell(row)}
      <td data-g=http data-value="${rank(row.ipv6)}">${flag(row.ipv6, ipv6Title)}
      <td data-g=http data-value="${rank(row.www_ok)}">${flag(row.www_ok, wwwTitle)}
      <td data-g=http data-value="${rank(row.soft_404)}">${flag(row.soft_404, row.soft_404 == null ? "unknown" : row.soft_404 ? "unknown paths answer 404" : "an unknown path answers like a real page")}
      <td data-g=tls data-value="${rank(row.cert_valid) === 1 ? -1 : row.cert_days}">${flag(certLow ? false : row.cert_valid, certTitle)}${row.cert_days != null ? html` <small>${row.cert_days} d</small>` : ""} ${flag(caa.length ? true : null, caa.length ? `CAA: ${caa.join(", ")}` : "no CAA record")}
      <td data-g=dns data-value="${rank(ns.ok)}|${row.dns_ns}">${nsCell(row, ns)}
      <td data-g=dns data-value="${row.dns_a}">${dnsCell(row.dns_a)}
      <td data-g=dns data-value="${aaaa.length ? 1 : 0}">${aaaa.length ? dot("green", aaaa.join(", ")) : dot("blue", "no AAAA record")}
      <td data-g=dns data-value="${row.dns_mx}">${dnsCell(row.dns_mx)}
      <td data-g=dns data-value="${txt.map(([label]) => label).join(",")}">${txtCell(txt)}
      <td data-g=dns data-value="${lines(row.dns_ttl).map((l) => Number(l.split("=")[1]) || 0).reduce((a, b) => Math.min(a, b), Infinity)}">${ttlCell(row)}
      <td data-g=dns data-value="${rank(row.dnssec)}">${dnssecCell(row)}
      <td data-g=mail data-value="${row.spf_error ? 1 : rank(row.spf_policy)}|${row.spf_lookups ?? 0}">${spfCell(row)}
      <td data-g=mail data-value="${row.dmarc_policy ?? ""}">${dmarcCell(row)}
      <td data-g=mail data-value="${rank(dkim.length ? true : null)}">${flag(dkim.length ? true : null, dkim.length ? `DKIM selectors: ${dkim.join(", ")}` : "no DKIM key found under the known selectors")}
      <td data-g=mail data-value="${row.mta_sts_mode ?? ""}">${row.mta_sts_mode ? html`${dot(row.mta_sts_mode === "enforce" ? "green" : "orange", `MTA-STS ${row.mta_sts_mode}`)} <small>${row.mta_sts_mode}</small>` : html`${dot("gray", row.mta_sts ? "MTA-STS record, but no policy fetched" : "no MTA-STS")}`}
      <td data-g=mail data-value="${rank(row.mail_starttls)}">${smtpCell(row)}
      <td data-value="${row.checked ?? 0}">${u2.time(row.checked, { narrow: true })}
      <td>${frequencySelect(row)}
      <td style="white-space:nowrap"
        ><button class=u2-unstyle data-action=check data-domain="${domain}" title="Check now"><u2-ico icon=refresh>↻</u2-ico></button
        ><button class=u2-unstyle data-action=expect data-domain="${domain}" data-expect="${row.expect}" title="${
    row.expect ? `Expected in body: ${row.expect}` : "Expect text in the body"
  }"><u2-ico icon=edit>✎</u2-ico></button
        ><button class=u2-unstyle data-action=delete data-domain="${domain}" u2-confirm="Delete ${domain}?"><u2-ico icon=delete>✕</u2-ico></button>`;
}

async function renderDetail(node: Node, ctx: Ctx, domain: string): Promise<HtmlString> {
  const row = await node.app.db.row<DomainRow>`SELECT * FROM monitor_domain WHERE domain = ${domain}`;
  const back = ctx.req.url.toURL();
  back.searchParams.delete("domain");
  if (!row) return html`<div class=u2-card><div class=-head>Domain monitor</div><div class=-body>
    <a href="${back.search || "?"}">← Domains</a><p>Domain not found.</div></div>`;

  const checks = await node.app.db.query<{ id: number; checked_at: number; result: string }>`
    SELECT id, checked_at, result FROM monitor_domain_check
    WHERE domain = ${domain} ORDER BY checked_at DESC LIMIT ${HISTORY_LIMIT}`;
  const current = status(row);
  const ns = nsState(row);
  const results = checks.map((check) => parseResult(check.result));
  const history = checks.map((check, index) => {
    const result = results[index];
    if (!result) return html`<tr><td>${u2.time(check.checked_at)}<td colspan=8>Invalid result data`;
    const state = checkedStatus(result.online, result.status_code, result.error, result.final_url);
    const cert = result.cert_valid == null ? "–" : result.cert_valid ? `${result.cert_days ?? "?"} d` : "invalid";
    return html`<tr>
      <td>${u2.time(check.checked_at)}
      <td>${dot(state.level, state.title)} ${state.title}
      <td>${changeCell(result, results[index + 1])}
      <td>${result.status_code ?? "–"}
      <td>${result.response_time != null ? `${result.response_time} ms` : "–"}
      <td>${cert}
      <td>${flag(result.redirect_https, "HTTPS redirect")}
      <td>${flag(result.ipv6, "IPv6")}
      <td><details><summary>Data</summary><pre>${JSON.stringify(result, null, 2)}</pre></details>`;
  });

  return html`<div class="u2-flex -detail">
    <div class=u2-card>
      <div class=-head><a href="${back.search || "?"}">← Domains</a> · ${domain}</div>
      <div class=-body>
        <p>${dot(current.level, current.title)} <b>${current.title}</b></p>
        <p><button data-action=check data-domain="${domain}">Check now</button> <button data-action=expect data-domain="${domain}" data-expect="${row.expect}">Expected text</button> ${frequencySelect(row)} <a href="https://${domain}/" target=_blank>Open website ↗</a></p>
      </div>
      <table class="u2-table -facts">
        ${factGroup("HTTP", [
          fact("Status code", row.status_code ?? "–"),
          fact("Response time", row.response_time != null ? `${row.response_time} ms` : "–"),
          fact("Final URL", row.final_url ?? "–"),
          fact("HTTPS redirect", state(row.redirect_https, "redirects to HTTPS")),
          fact("HSTS", row.hsts ? `${Math.round(row.hsts / 86400)} days${row.hsts_flags ? ` · ${row.hsts_flags}` : ""}` : "–"),
          fact("Missing headers", row.headers_missing || "none"),
          fact("HTTP/3", row.alt_svc || "–"),
          fact("Unknown paths", state(row.soft_404, "answer with a 4xx status")),
          fact("www", state(row.www_ok, `${wwwAlt(domain)} answers`)),
          fact("IPv6", state(row.ipv6, "reachable over IPv6")),
        ])}
        ${factGroup("Certificate", [
          fact("Validity", row.cert_valid == null ? "–" : row.cert_valid ? `${row.cert_days ?? "?"} days remaining` : "invalid"),
          fact("Issuer", row.cert_issuer || "–"),
          fact("Covers this host", state(row.cert_names_ok, "the host is among the certificate names")),
          fact("Names", records(row.cert_names)),
          fact("CAA", records(row.dns_caa)),
        ])}
        ${factGroup("DNS", [
          fact("NS", ns.list.length ? html.join(ns.list.map((s) => html`<div>${s.name} <small>${s.ip || "no answer"}${s.serial ? ` · serial ${s.serial}` : ""}</small></div>`)) : records(row.dns_ns)),
          fact("NS answering", ns.list.length ? `${ns.answering.length}/${ns.list.length}` : "–"),
          fact("NS in sync", state(ns.answering.length ? ns.sync : null, "all name servers return the same records")),
          fact("NS subnets", ns.answering.length ? ns.subnets : "–"),
          fact("Parent delegation", state(ns.parent, "the parent delegates to the same servers")),
          fact("Parent NS", records(row.dns_ns_parent)),
          fact("DNSSEC", state(row.dnssec, "signed and delegated")),
          fact("DS", records(row.dns_ds)),
          fact("SOA", row.soa_primary ? `${row.soa_primary} · serial ${row.soa_serial ?? "?"}` : "–"),
          fact("SOA expire", row.soa_expire ? `${Math.round(row.soa_expire / 86400)} days` : "–"),
          fact("Negative TTL", row.soa_minimum != null ? `${row.soa_minimum} s` : "–"),
          fact("Record TTL", records(row.dns_ttl)),
          fact("A", records(row.dns_a)),
          fact("AAAA", records(row.dns_aaaa)),
          fact("CNAME", records(row.dns_cname)),
          fact("HTTPS", records(row.dns_https)),
          fact("MX", records(row.dns_mx)),
          fact("TXT", records(row.dns_txt)),
        ])}
        ${factGroup("Mail", [
          fact("MX hosts", row.mail_null_mx ? "null MX — receives no mail" : records(row.mail_hosts)),
          fact("MX resolve", state(row.mail_hosts_ok, "every MX host has an address")),
          fact("STARTTLS", state(row.mail_starttls, "the mail server offers STARTTLS")),
          fact("Mail certificate", state(row.mail_tls_valid, "valid for the mail host")),
          fact("Greeting", row.mail_banner || "–"),
          fact("DANE", records(row.mail_dane)),
          fact("SPF", row.spf || "–"),
          fact("SPF policy", row.spf_policy ? `${row.spf_policy} · ${row.spf_lookups ?? 0}/10 lookups${row.spf_error ? ` · ${row.spf_error}` : ""}` : "–"),
          fact("DMARC", records(row.dns_dmarc)),
          fact("DMARC policy", row.dmarc_policy ? `p=${row.dmarc_policy}${row.dmarc_sub ? `, sp=${row.dmarc_sub}` : ""}, pct=${row.dmarc_pct ?? 100}` : "–"),
          fact("DMARC reports", state(row.dmarc_rua, "a report address is published")),
          fact("DKIM selectors", records(row.dkim)),
          fact("MTA-STS", row.mta_sts ? `${row.mta_sts_mode || "no policy"} · ${row.mta_sts}` : "–"),
          fact("TLS reporting", row.tls_rpt || "–"),
          fact("BIMI", row.bimi || "–"),
        ])}
        ${factGroup("Registry", [
          fact("Registered", no(row.reg_found) ? "not registered" : state(row.reg_found, "known to the registry")),
          fact("Expires", time(row.reg_expires, "–")),
          fact("Created", time(row.reg_created, "–")),
          fact("Registrar", row.reg_registrar || "–"),
          fact("Transfer lock", state(row.reg_locked, "the registry blocks transfers")),
          fact("Status", row.reg_status || "–"),
        ])}
        ${factGroup("Monitoring", [
          fact("Last checked", time(row.checked, "never")),
          fact("Last full check", time(row.checked_deep, "never")),
          fact("Last change", time(row.changed, "never")),
          fact("Changed fields", records(row.changes)),
          fact("Frequency", row.check_frequency ?? "–"),
          fact("Expected text", row.expect || "–"),
          fact("Added", time(row.created)),
          ...(row.error ? [fact("Error", row.error)] : []),
        ])}
      </table>
    </div>
    <div class="u2-card -full" style="flex:2 1 50rem">
      <div class=-head>Check history (${checks.length}${checks.length === HISTORY_LIMIT ? "+" : ""})</div>
      <u2-table class=-history>
        <table class="u2-table -Sticky">
          <thead><tr>
            <th>Checked
            <th>Result
            <th>Changes
            <th>Code
            <th>Time
            <th>Cert
            <th>HTTPS
            <th>IPv6
            <th>
          <tbody>${history.length ? html.join(history) : html`<tr><td colspan=9>No checks yet.`}
        </table>
      </u2-table>
    </div>
  </div>`;
}

const WIDGET_ROWS = 8;

/** Dashboard card: what moved lately, which is the one thing worth seeing without opening the module. */
export async function backendDashboardWidget(app: App, node: Node): Promise<HtmlString | string> {
  const rows = await app.db.query<DomainRow>`
    SELECT domain, changed, changes FROM monitor_domain WHERE changed > 0 ORDER BY changed DESC LIMIT ${WIDGET_ROWS}`;
  if (!rows.length) return ""; // nothing has ever changed — no card rather than an empty one
  const pageUrl = await nodeUrl(node, getCtx());
  return html.async`<table class=u2-table style="white-space:nowrap">${
    html.join(rows.map((row) => {
      const fields = lines(row.changes);
      return html`<tr>
      <td><a href="${detailLink(pageUrl, row.domain)}">${row.domain}</a>
      <td><small title="${fields.join(", ")}">${fields.slice(0, 2).join(", ")}${fields.length > 2 ? ` +${fields.length - 2}` : ""}</small>
      <td>${changedCell(row)}`;
    }))
  }</table>`;
}

export async function render(node: Node, { ctx, vars = {} }: { ctx: Ctx; vars?: Record<string, unknown> }): Promise<HtmlString> {
  const domain = String(ctx.req.query.domain ?? "");
  if (domain) return renderDetail(node, ctx, domain);

  const app = node.app;
  const skipped = vars.add ? await addDomains(app, String(vars.domains ?? "")) : [];
  const rows = await app.db.query<DomainRow>`SELECT * FROM monitor_domain ORDER BY sort, domain`;
  const pageUrl = await nodeUrl(node, ctx);
  const body = html.join(rows.map((row) => rowHtml(row, pageUrl)), "\n");
  const empty = html`<tr><td colspan=28 class=-empty>No domains yet.`;

  // Which groups the user folded away, kept per user rather than per browser. Mail is off to begin
  // with — it is the most specialised block and the table is wide enough without it.
  const stored = String(ctx.settings["cms.backend.domain-monitor"].cols() ?? "mail").split(",");
  const hidden = GROUPS.filter((group) => stored.includes(group));

  return html`<div class=u2-card>
  <div class=-head>Domain monitor (<span data-monitor-count>${rows.length}</span>)</div>
  <div class=-body style="display:flex; gap:.5rem; flex-wrap:wrap; align-items:center">
    <input type=search placeholder="search…" data-monitor-search style="width:15rem; max-width:100%">
    <select data-monitor-filter>
      <option value="">all</option>
      <option value=ok>ok</option>
      <option value=problem>problems</option>
      <option value=changed>changed (7 days)</option>
    </select>
    <span data-bulk hidden><b data-bulk-count>0</b> selected ·
      <select data-bulk-frequency title="Set automatic checks for the selected domains">
        <option value="">set interval…</option>
        ${html.join(frequencies.map((value) => html`<option value="${value}">${value === "disabled" ? "off" : value}`))}
      </select>
      <button data-action=checkSelected>Check</button>
      <button data-action=deleteSelected data-bulk-delete>Delete</button>
    </span>
    <span class=-cols>${html.join(GROUPS.map((group) =>
      html`<label><input type=checkbox data-col="${group}" ${hidden.includes(group) ? "" : "checked"}> ${GROUP_LABELS[group]}</label>`
    ))}</span>
  </div>
  <u2-table>
    <table class="u2-table -Sticky -domains ${hidden.map((group) => "-no-" + group).join(" ")}">
      <thead><tr>
        <th width=1><input type=checkbox data-select-all title="Select every row the search and filter leave visible">
        <th data-sort-handler width=2 class=-v>Status
        <th data-sort-handler>Domain
        <th data-sort-handler width=5>Changed
        <th data-sort-handler width=3>Expires
        <th data-g=http data-sort-handler width=5>Code
        <th data-g=http data-sort-handler>Time
        <th data-g=http data-sort-handler class=-v>HTTPS
        <th data-g=http data-sort-handler width=2 class=-v>Headers
        <th data-g=http data-sort-handler width=2 class=-v>IPv6
        <th data-g=http data-sort-handler width=2 class=-v>www
        <th data-g=http data-sort-handler width=2 class=-v>404
        <th data-g=tls data-sort-handler width=3 class=-v>Cert
        <th data-g=dns data-sort-handler>NS
        <th data-g=dns data-sort-handler>A
        <th data-g=dns data-sort-handler width=2 class=-v>AAAA
        <th data-g=dns data-sort-handler>MX
        <th data-g=dns data-sort-handler>TXT
        <th data-g=dns data-sort-handler width=3 class=-v>TTL
        <th data-g=dns data-sort-handler width=2 class=-v>DNSSEC
        <th data-g=mail data-sort-handler width=3 class=-v>SPF
        <th data-g=mail data-sort-handler width=3 class=-v>DMARC
        <th data-g=mail data-sort-handler width=2 class=-v>DKIM
        <th data-g=mail data-sort-handler width=3 class=-v>MTA-STS
        <th data-g=mail data-sort-handler width=2 class=-v>SMTP
        <th data-sort-handler width=5>Checked
        <th data-sort-handler>Automatic
        <th width=1>
      <tbody data-monitor-list>${rows.length ? body : empty}
    </table>
  </u2-table>
  <div class=-body style="display:flex; gap:.5rem; flex-wrap:wrap; align-items:end">
    <label style="flex:1">Add domains <small>(one per line)</small><br><textarea name=domains rows=3 placeholder="example.com&#10;sub.example.org" style="width:100%"></textarea>${
      skipped.length ? html`<small>Skipped, no valid domain: ${skipped.join(", ")}</small>` : ""
    }</label>
    <button data-action=add>Add</button>
  </div>
</div>`;
}
