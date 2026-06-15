import { getCtx, hee, type App, type RequestContext } from "../core/mod.ts";
import { settings } from "./store.ts";
import type { Node } from "../cms/mod.ts";
import type { RowDataPacket } from "../../deps.ts";

export async function backendDashboardWidget(app: App): Promise<string> {
  const row = await app.db.row("SELECT COUNT(*) events, SUM(blocked) blocked, SUM(CASE WHEN state='new' THEN 1 ELSE 0 END) fresh, MAX(time) last FROM m_security_event").catch(() => null);
  if (!row || !Number(row.events)) return `<div class="-body">${await app.t`No security events.`}</div>`;
  const buckets = await app.db.all("SELECT scope,ident,score,reason FROM m_security_bucket ORDER BY score DESC LIMIT 5");
  return `<div class="-body">
    <b>${hee(row.events)}</b> ${await app.t`Events`}, <b>${hee(row.fresh ?? 0)}</b> ${await app.t`new`}, <b>${hee(row.blocked ?? 0)}</b> ${await app.t`blocked`}<br>
    <small>${await app.t`Last alarm:`} ${u2time(row.last)}</small>
    ${buckets.length ? `<table class="u2-table">${buckets.map((r) => `<tr><td>${hee(r.score)}<td>${hee(r.scope)}<td><code>${hee(r.ident)}</code><td>${hee(r.reason)}`).join("")}</table>` : ""}
  </div>`;
}

export async function render(node: Node, { vars = {} }: { vars?: Record<string, unknown> } = {}): Promise<string> {
  const ctx = getCtx();
  const app = node.app;
  if (!await ctx.user?.get?.("superuser")) return "<div></div>";
  const db = app.db;
  const set = await settings(app);
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
  const stats: Record<string, unknown> = await db.row("SELECT COUNT(*) events, SUM(blocked) blocked, SUM(CASE WHEN state='new' THEN 1 ELSE 0 END) fresh FROM m_security_event") ?? {};
  const tab = String(ctx.get.tab ?? "live");
  return `<div>
    <div class="u2-flex">
      ${await statusBox(app, stats)}
      <div>
        ${tabs(tab)}
        ${tab === "settings" ? settingsEditor(ctx) : ""}
        ${tab === "buckets" ? await bucketTable(app, buckets) : ""}
        ${tab === "analyse" ? '<div class=u2-flex>' + topTable("Top IPs", topIps, "ip") + topTable("Top Paths", topPaths, "path") + topTable("Top Kinds", topKinds, "kind") + topTable("Top Clients", topUa, "ua") : ""}
        ${tab === "live" ? await eventTable(app, events, ctx.get) : ""}
      </div>
    </div>
  </div>`;
}

async function statusBox(app: App, stats: Record<string, unknown>) {
  return `<div class="u2-card -kpi"><div class="-head">${await app.t`Status`}</div><div class="-body">
    <b>${hee(stats.events ?? 0)}</b> ${await app.t`Events`}<br><b>${hee(stats.fresh ?? 0)}</b> ${await app.t`new`}<br><b>${hee(stats.blocked ?? 0)}</b> ${await app.t`Blocked`}<br>
    <button data-action="clearEvents" u2-confirm>${await app.t`Clear events`}</button>
    <button data-action="clearBuckets" u2-confirm>${await app.t`Clear buckets`}</button>
  </div></div>`;
}

function tabs(active: string) {
  return `<u2-buttongroup style="margin-bottom:1rem">${["live","buckets","analyse","settings"].map(v => `<a href="?tab=${v}" class="btn ${v===active?"-active":""}">${hee(v)}</a>`).join("")}</u2-buttongroup>`;
}

function settingsEditor(ctx: RequestContext) {
  ctx.html.scripts.add(ctx.sysURL + "core/pub/js/SettingsEditor.mjs");
  return `<div class="u2-card"><settings-editor source="/api/core/settings/cms.backend.security"></settings-editor></div>`;
}

async function bucketTable(app: App, rows: Record<string, unknown>[]) {
  const [tHead, tScore, tScope, tIdent, tCount, tLast, tReason, tRelease, tBlock] = await Promise.all([
    app.t`Suspicious buckets`, app.t`Score`, app.t`Scope`, app.t`Ident`, app.t`Count`, app.t`Last`, app.t`Reason`, app.t`release`, app.t`block`,
  ]);
  return `<div class="u2-card -table"><div class="-head">${tHead}</div><table class="u2-table -Sticky">
    <thead><tr><th>${tScore}<th>${tScope}<th>${tIdent}<th>${tCount}<th>${tLast}<th>${tReason}<th>
    <tbody>${rows.map(r => `<tr class="${r.blocked?"-blocked":""}">
      <td>${hee(r.score)}<td>${hee(r.scope)}<td><code>${hee(r.ident)}</code><td>${hee(r.count)}<td>${u2time(r.last_seen)}<td>${hee(r.reason)}<td><button data-release="${r.id}">${tRelease}</button> <button data-block="${r.id}">${tBlock}</button>`).join("")}
  </table></div>`;
}

async function eventTable(app: App, rows: RowDataPacket[], get: Record<string, string>) {
  const [tHead, tTime, tEvent, tScore, tAffected, tAction, tReason, tRequest, tStatus] = await Promise.all([
    app.t`Alarms / Requests`, app.t`Time`, app.t`Event`, app.t`Score`, app.t`Affected`, app.t`Action`, app.t`Reason`, app.t`Request`, app.t`Status`,
  ]);
  return `<div class="u2-card -table"><div class="-head">${tHead}</div>
    ${await eventFilter(app, get)}
    <table class="u2-table -Sticky">
      <thead><tr><th>${tTime}<th>${tEvent}<th>${tScore}<th>${tAffected}<th>${tAction}<th>${tReason}<th>${tRequest}<th>${tStatus}<th>
    <tbody>${rows.map(r => `<tr class="-${hee(r.prio)}">
      <td>${u2time(r.time)}<td>${eventCell(r)}<td>${scoreCell(r)}<td>${bucketCell(r)}<td>${actionCell(r)}<td>${hee(r.reason)}<td>${requestCell(r)}<td>${stateCell(r)}<td>${eventActions(r)}`).join("")}
  </table></div>`;
}

function eventCell(r: RowDataPacket) {
  return `${tag(r.kind || "-")}<br><small>${hee(prioLabels[r.prio] ?? r.prio)}</small>`;
}

function scoreCell(r: RowDataPacket) {
  const meta = [`Conf. ${r.confidence ?? 0}`, `Severity ${r.severity ?? 0}`].join(" / ");
  return `<b>${hee(r.score)}</b><br><small>${hee(meta)}</small>`;
}

function bucketCell(r: RowDataPacket) {
  return r.scope || r.ident ? `${tag(scopeLabels[r.scope] ?? (r.scope || "-"))}<br><code>${hee(r.ident || "-")}</code>` : "-";
}

function actionCell(r: RowDataPacket) {
  const parts = [];
  if (Number(r.blocked)) parts.push("Block");
  if (Number(r.delay_ms)) parts.push(hee(r.delay_ms) + "ms Delay");
  if (Number(r.status)) parts.push("http " + hee(r.status));
  return parts.length ? parts.join("<br>") : "-";
}

function requestCell(r: RowDataPacket) {
  const meta = [r.method, r.ip, r.duration_ms ? r.duration_ms + "ms" : "", bytes(r.bytes_in, "in"), bytes(r.bytes_out, "out")].filter(Boolean);
  const ids = [r.log_id ? "log " + r.log_id : "", r.usr_id ? "user " + r.usr_id : "", r.client_id ? "client " + r.client_id : ""].filter(Boolean);
  return `<code>${hee(r.path)}</code>${meta.length ? `<br><small>${hee(meta.join(" · "))}</small>` : ""}${ids.length ? `<br><small>${hee(ids.join(" · "))}</small>` : ""}`;
}

function stateCell(r: RowDataPacket) {
  return tag(stateLabels[r.state] ?? r.state ?? "-");
}

function eventActions(r: RowDataPacket) {
  if (r.prio === "notice") return "";
  return `<button data-seen="${r.id}">seen</button> <button data-ignore="${r.id}">ignore</button>`;
}

function topTable(title: string, rows: Record<string, unknown>[], key: string) {
  return `<div class="u2-card -table -toplist"><div class="-head">${hee(title)}</div><table class="u2-table">
    ${rows.map(r => `<tr><td>${hee(r.num)}<td><a href="?tab=live&q=${encodeURIComponent(String(r[key] ?? ""))}"><code>${hee(r[key])}</code></a><td>${u2time(r.last)}`).join("")}
  </table></div>`;
}

async function eventFilter(app: App, get: Record<string, string>) {
  return `<form class="u2-flex">
    <input type="hidden" name="tab" value="live">
    <input name="q" value="${hee(get.q ?? "")}" placeholder="${await app.t`IP, path, reason`}">
    <select name="prio"><option value="">${await app.t`Severity`}${opts(["notice","warning","error"], get.prio, prioLabels)}</select>
    <select name="kind"><option value="">${await app.t`Event`}${opts(["attack","path-block","probe","login","load","throttle","request"], get.kind, kindLabels)}</select>
    <select name="scope"><option value="">${await app.t`Bucket`}${opts(["ip","range","client","user","path","attack:ip","attack:range","attack:path","login:ip","login:range","login:user"], get.scope, scopeLabels)}</select>
    <select name="blocked"><option value="">${await app.t`Action`}${opts(["blocked","delayed"], get.blocked, actionLabels)}</select>
    <select name="state"><option value="">${await app.t`Status`}${opts(["new","seen","ignore"], get.state, stateLabels)}</select>
    <input name="min" value="${hee(get.min ?? "")}" placeholder="${await app.t`min severity`}">
    <button>${await app.t`filter`}</button>
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

const prioLabels: Record<string, string> = { notice: "Info", warning: "Warning", error: "Critical" };
const kindLabels: Record<string, string> = { attack: "Attack", "path-block": "Path block", probe: "Probe", login: "Login", load: "Load", throttle: "Throttle", request: "Request" };
const scopeLabels: Record<string, string> = { ip: "IP", range: "IP range", client: "Client", user: "User", path: "Path", "attack:ip": "Attack/IP", "attack:range": "Attack/Range", "attack:path": "Attack/Path", "login:ip": "Login/IP", "login:range": "Login/Range", "login:user": "Login/User" };
const stateLabels: Record<string, string> = { new: "new", seen: "seen", ignore: "ignored" };
const actionLabels: Record<string, string> = { blocked: "blocked", delayed: "delayed" };

const opts = (vs: string[], active = "", labels: Record<string, string> = {}) => vs.map(v => `<option value="${hee(v)}"${v===active?" selected":""}>${hee(labels[v] ?? v)}`).join("");
const tag = (v: unknown) => `<span class="u2-badge">${hee(v)}</span>`;
const bytes = (n: unknown, name: string) => Number(n) ? name + " " + hee(humanBytes(Number(n))) : "";

function humanBytes(n: number) {
  if (n < 1024) return n + "B";
  if (n < 1024 * 1024) return Math.round(n / 1024) + "KB";
  return Math.round(n / 1024 / 1024 * 10) / 10 + "MB";
}

function u2time(t: unknown) {
  const d = new Date(Number(t) * 1000);
  if (Number.isNaN(d.getTime())) return "-";
  const iso = d.toISOString();
  return `<u2-time datetime="${iso}" type=relative minute>${iso.slice(0, 16).replace("T", " ")}</u2-time>`;
}
