// deno-lint-ignore-file no-explicit-any
import { getCtx } from "../core/lib/RequestContext.ts";
import { hee } from "../core/lib/util.ts";
import { normalizePathList } from "./pathlist.ts";
import { defaults, settingInfo, textDefaults } from "./schema.ts";
import { saveSetting, settings, textSettings } from "./store.ts";

export async function backendDashboardWidget(app: any): Promise<string> {
  const row = await app.db.row("SELECT COUNT(*) events, SUM(blocked) blocked, SUM(CASE WHEN state='new' THEN 1 ELSE 0 END) fresh, MAX(time) last FROM m_security_event").catch(() => null);
  if (!row || !Number(row.events)) return `<div class="-body">Keine Security-Events.</div>`;
  const buckets = await app.db.all("SELECT scope,ident,score,reason FROM m_security_bucket ORDER BY score DESC LIMIT 5");
  return `<div class="-body">
    <b>${hee(row.events)}</b> Events, <b>${hee(row.fresh ?? 0)}</b> neu, <b>${hee(row.blocked ?? 0)}</b> geblockt<br>
    <small>Letzter Alarm: ${u2time(row.last)}</small>
    ${buckets.length ? `<table class="u2-table">${buckets.map((r: any) => `<tr><td>${hee(r.score)}<td>${hee(r.scope)}<td><code>${hee(r.ident)}</code><td>${hee(r.reason)}`).join("")}</table>` : ""}
  </div>`;
}

export async function render(node: any, { vars = {} }: { vars?: Record<string, any> } = {}): Promise<string> {
  const ctx = getCtx() as any;
  if (!await ctx.user?.get?.("superuser")) return "<div></div>";
  const db = node.app.db;
  if (vars.save) for (const [k, v] of Object.entries(vars.save)) if (k in defaults) await saveSetting(db, k, String(v));
  if (vars.text) for (const [k, v] of Object.entries(vars.text)) if (k in textDefaults) await saveSetting(db, k, normalizePathList(String(v)));
  const set = await settings(db);
  const text = await textSettings(db);
  if (vars.clearEvents) await db.query("DELETE FROM m_security_event");
  if (vars.clearBuckets) await db.query("DELETE FROM m_security_bucket");
  if (vars.release) await db.table("m_security_bucket").update(vars.release, { score: 0, blocked: 0, reason: "released" });
  if (vars.block) await db.table("m_security_bucket").update(vars.block, { score: set.blockScore, blocked: 1, reason: "manual block" });
  if (vars.seen) await db.table("m_security_event").update(vars.seen, { state: "seen" });
  if (vars.ignore) await db.table("m_security_event").update(vars.ignore, { state: "ignore" });
  const buckets = await db.all("SELECT * FROM m_security_bucket ORDER BY score DESC,last_seen DESC LIMIT 80");
  const [where, params] = eventWhere(ctx.get);
  const events = await db.all(`SELECT * FROM m_security_event ${where ? "WHERE " + where : ""} ORDER BY id DESC LIMIT 120`, params);
  const topIps = await db.all("SELECT ip, COUNT(*) num, MAX(time) last FROM m_security_event WHERE ip!='' GROUP BY ip ORDER BY num DESC,last DESC LIMIT 10");
  const topPaths = await db.all("SELECT path, COUNT(*) num, MAX(time) last FROM m_security_event WHERE path!='' GROUP BY path ORDER BY num DESC,last DESC LIMIT 10");
  const topKinds = await db.all("SELECT kind, COUNT(*) num, MAX(time) last FROM m_security_event WHERE kind!='' GROUP BY kind ORDER BY num DESC,last DESC LIMIT 10");
  const topUa = await db.all("SELECT ua, COUNT(*) num, MAX(time) last FROM m_security_event WHERE ua!='' GROUP BY ua ORDER BY num DESC,last DESC LIMIT 10");
  const stats: any = await db.row("SELECT COUNT(*) events, SUM(blocked) blocked, SUM(CASE WHEN state='new' THEN 1 ELSE 0 END) fresh FROM m_security_event") ?? {};
  const tab = String(ctx.get.tab ?? "live");
  return `<div class="-m-cms-backend-security">
    <div class="u2-flex -top">
      ${statusBox(stats)}
    </div>
    ${tabs(tab)}
    ${aptScript(node)}
    <div class="u2-flex">
      ${tab === "settings" ? settingsBox(set, text) : ""}
      ${tab === "buckets" ? bucketTable(buckets) : ""}
      ${tab === "analyse" ? topTable("Top IPs", topIps, "ip") + topTable("Top Paths", topPaths, "path") + topTable("Top Kinds", topKinds, "kind") + topTable("Top Clients", topUa, "ua") : ""}
      ${tab === "live" ? eventTable(events, ctx.get) : ""}
    </div>
  </div>`;
}

function statusBox(stats: any) {
  return `<div class="u2-card -kpi"><div class="-head">Status</div><div class="-body">
    <b>${hee(stats.events ?? 0)}</b> Events<br><b>${hee(stats.fresh ?? 0)}</b> neu<br><b>${hee(stats.blocked ?? 0)}</b> Blocked<br>
    <button data-action="clearEvents" u2-confirm>Events leeren</button>
    <button data-action="clearBuckets" u2-confirm>Buckets leeren</button>
  </div></div>`;
}

function tabs(active: string) {
  return `<nav class="-tabs">${["live","buckets","analyse","settings"].map(v => `<a href="?tab=${v}" class="${v===active?"-active":""}">${hee(v)}</a>`).join("")}</nav>`;
}

function settingsBox(set: Record<string, number>, text: Record<string, string>) {
  return `<form class="u2-card -settings" data-settings>
    <div class="-head">Settings</div>
    <div class="-body">
      ${Object.entries(set).map(([k, v]) => settingField(k, v)).join("")}
      <button>speichern</button>
    </div>
  </form>
  <form class="u2-card -paths" data-text>
    <div class="-head">Verdächtige Pfade</div>
    <div class="-body">
      <textarea name="suspiciousPaths" spellcheck="false">${hee(text.suspiciousPaths ?? "")}</textarea>
      <label>Erlaubte Pfade<textarea name="allowedPaths" spellcheck="false">${hee(text.allowedPaths ?? "")}</textarea></label>
      <button>importieren / speichern</button>
    </div>
  </form>`;
}

function settingField(k: string, v: number) {
  const [label, unit] = settingInfo[k] ?? [k, ""];
  return `<label><span>${hee(label)}${unit ? ` <small>${hee(unit)}</small>` : ""}</span><input name="${hee(k)}" value="${hee(v)}"></label>`;
}

function aptScript(node: any) {
  return `<script type=module>import{apt}from'${getCtx().sysURL}core/pub/js/apt.js';globalThis.apt=apt;globalThis.securityNode=${node.id};</script>`;
}

function bucketTable(rows: any[]) {
  return `<div class="u2-card -table"><div class="-head">Verdächtige Buckets</div><table class="u2-table -Sticky">
    <thead><tr><th>Score<th>Scope<th>Ident<th>Count<th>Last<th>Reason<th>
    <tbody>${rows.map(r => `<tr class="${r.blocked?"-blocked":""}">
      <td>${hee(r.score)}<td>${hee(r.scope)}<td><code>${hee(r.ident)}</code><td>${hee(r.count)}<td>${u2time(r.last_seen)}<td>${hee(r.reason)}<td><button data-release="${r.id}">frei</button> <button data-block="${r.id}">sperren</button>`).join("")}
  </table></div>`;
}

function eventTable(rows: any[], get: Record<string, string>) {
  return `<div class="u2-card -table"><div class="-head">Alarme / Aufrufe</div><table class="u2-table -Sticky">
    <caption>${eventFilter(get)}</caption>
    <thead><tr><th>Zeit<th>Ereignis<th>Bewertung<th>Betroffen<th>Aktion<th>Grund<th>Request<th>Status<th>
    <tbody>${rows.map(r => `<tr class="-${hee(r.prio)}">
      <td>${u2time(r.time)}<td>${eventCell(r)}<td>${scoreCell(r)}<td>${bucketCell(r)}<td>${actionCell(r)}<td>${hee(r.reason)}<td>${requestCell(r)}<td>${stateCell(r)}<td>${eventActions(r)}`).join("")}
  </table></div>`;
}

function eventCell(r: any) {
  return `${tag(r.kind || "-")}<br><small>${hee(prioLabels[r.prio] ?? r.prio)}</small>`;
}

function scoreCell(r: any) {
  const meta = [`Konf. ${r.confidence ?? 0}`, `Härte ${r.severity ?? 0}`].join(" / ");
  return `<b>${hee(r.score)}</b><br><small>${hee(meta)}</small>`;
}

function bucketCell(r: any) {
  return r.scope || r.ident ? `${tag(scopeLabels[r.scope] ?? (r.scope || "-"))}<br><code>${hee(r.ident || "-")}</code>` : "-";
}

function actionCell(r: any) {
  const parts = [];
  if (Number(r.blocked)) parts.push("Block");
  if (Number(r.delay_ms)) parts.push(hee(r.delay_ms) + "ms Delay");
  if (Number(r.status)) parts.push("http " + hee(r.status));
  return parts.length ? parts.join("<br>") : "-";
}

function requestCell(r: any) {
  const meta = [r.method, r.ip, r.duration_ms ? r.duration_ms + "ms" : "", bytes(r.bytes_in, "in"), bytes(r.bytes_out, "out")].filter(Boolean);
  const ids = [r.log_id ? "log " + r.log_id : "", r.usr_id ? "user " + r.usr_id : "", r.client_id ? "client " + r.client_id : ""].filter(Boolean);
  return `<code>${hee(r.path)}</code>${meta.length ? `<br><small>${hee(meta.join(" · "))}</small>` : ""}${ids.length ? `<br><small>${hee(ids.join(" · "))}</small>` : ""}`;
}

function stateCell(r: any) {
  return tag(stateLabels[r.state] ?? r.state ?? "-");
}

function eventActions(r: any) {
  if (r.prio === "notice") return "";
  return `<button data-seen="${r.id}">gesehen</button> <button data-ignore="${r.id}">ignorieren</button>`;
}

function topTable(title: string, rows: any[], key: string) {
  return `<div class="u2-card -table -toplist"><div class="-head">${hee(title)}</div><table class="u2-table">
    ${rows.map(r => `<tr><td>${hee(r.num)}<td><a href="?tab=live&q=${encodeURIComponent(r[key])}"><code>${hee(r[key])}</code></a><td>${u2time(r.last)}`).join("")}
  </table></div>`;
}

function eventFilter(get: Record<string, string>) {
  return `<form class="-filter">
    <input type="hidden" name="tab" value="live">
    <input name="q" value="${hee(get.q ?? "")}" placeholder="IP, Pfad, Grund">
    <select name="prio"><option value="">Bewertung</option>${opts(["notice","warning","error"], get.prio, prioLabels)}</select>
    <select name="kind"><option value="">Ereignis</option>${opts(["attack","path-block","probe","login","load","throttle","request"], get.kind, kindLabels)}</select>
    <select name="scope"><option value="">Bucket</option>${opts(["ip","range","client","user","path","attack:ip","attack:range","attack:path","login:ip","login:range","login:user"], get.scope, scopeLabels)}</select>
    <select name="blocked"><option value="">Aktion</option>${opts(["blocked","delayed"], get.blocked, actionLabels)}</select>
    <select name="state"><option value="">Status</option>${opts(["new","seen","ignore"], get.state, stateLabels)}</select>
    <input name="min" value="${hee(get.min ?? "")}" placeholder="min Härte">
    <button>filtern</button>
  </form>`;
}

function eventWhere(get: Record<string, string>): [string, unknown[]] {
  const sql: string[] = [], params: unknown[] = [];
  if (get.prio) { sql.push("prio = ?"); params.push(get.prio); }
  if (get.kind) { sql.push("kind = ?"); params.push(get.kind); }
  if (get.scope) { sql.push("scope = ?"); params.push(get.scope); }
  if (get.blocked === "blocked") sql.push("blocked = 1");
  if (get.blocked === "delayed") sql.push("delay_ms > 0");
  if (get.state) { sql.push("state = ?"); params.push(get.state); }
  if (get.min) { sql.push("severity >= ?"); params.push(Number(get.min) || 0); }
  if (get.q) { sql.push("(ip LIKE ? OR path LIKE ? OR reason LIKE ? OR ident LIKE ?)"); params.push(...Array(4).fill("%" + get.q + "%")); }
  return [sql.join(" AND "), params];
}

const prioLabels: Record<string, string> = { notice: "Info", warning: "Warnung", error: "Kritisch" };
const kindLabels: Record<string, string> = { attack: "Angriff", "path-block": "Pfadblock", probe: "Probe", login: "Login", load: "Last", throttle: "Drosselung", request: "Request" };
const scopeLabels: Record<string, string> = { ip: "IP", range: "IP-Range", client: "Client", user: "User", path: "Pfad", "attack:ip": "Angriff/IP", "attack:range": "Angriff/Range", "attack:path": "Angriff/Pfad", "login:ip": "Login/IP", "login:range": "Login/Range", "login:user": "Login/User" };
const stateLabels: Record<string, string> = { new: "neu", seen: "gesehen", ignore: "ignoriert" };
const actionLabels: Record<string, string> = { blocked: "blockiert", delayed: "verzögert" };

const opts = (vs: string[], active = "", labels: Record<string, string> = {}) => vs.map(v => `<option value="${hee(v)}"${v===active?" selected":""}>${hee(labels[v] ?? v)}</option>`).join("");
const tag = (v: unknown) => `<span class="-tag">${hee(v)}</span>`;
const bytes = (n: unknown, name: string) => Number(n) ? name + " " + hee(humanBytes(Number(n))) : "";

function humanBytes(n: number) {
  if (n < 1024) return n + "B";
  if (n < 1024 * 1024) return Math.round(n / 1024) + "KB";
  return Math.round(n / 1024 / 1024 * 10) / 10 + "MB";
}

function u2time(t: unknown) {
  const d = new Date(Number(t) * 1000);
  if (isNaN(d.getTime())) return "-";
  const iso = d.toISOString();
  return `<u2-time datetime="${iso}" type=relative minute>${iso.slice(0, 16).replace("T", " ")}</u2-time>`;
}
