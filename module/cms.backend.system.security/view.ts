import { getCtx, html, sql } from "@qino/qino";
import * as u2 from "@qino/qino/u2";

import { settings } from "./store.ts";

import type { App, Ctx, HtmlString, Row, Sql } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export async function backendDashboardWidget(app: App): Promise<HtmlString> {
  const row = await app.db.row`SELECT COUNT(*) events, SUM(CASE WHEN blocked THEN 1 ELSE 0 END) blocked, SUM(CASE WHEN state='new' THEN 1 ELSE 0 END) fresh, MAX(time) last FROM m_security_event`.catch(() => null);
  if (!row || !Number(row.events)) return html`<div class=-body>${await app.t`No security events.`}</div>`;
  const buckets = await app.db.query`SELECT scope,ident,score,reason FROM m_security_bucket ORDER BY score DESC LIMIT 5`;
  return html.async`<div class=-body>
    <b>${row.events}</b> ${app.t`Events`}, <b>${row.fresh ?? 0}</b> ${app.t`new`}, <b>${row.blocked ?? 0}</b> ${app.t`blocked`}<br>
    <small>${app.t`Last alarm:`} ${u2.el.time(row.last)}</small>
    ${buckets.length ? html`<table class=u2-table>${buckets.map((r) => html`<tr>
      <td>${r.score}
      <td>${r.scope}
      <td><code>${r.ident}</code>
      <td>${r.reason}`)}</table>` : ""}
  </div>`;
}

export async function render(node: Node, { vars = {} }: { vars?: Record<string, unknown> } = {}): Promise<HtmlString> {
  const ctx = getCtx();
  const app = node.app;
  const db = app.db;
  const set = await settings(app);
  if (vars.clearEvents) await db.exec`DELETE FROM m_security_event`;
  if (vars.clearBuckets) await db.exec`DELETE FROM m_security_bucket`;
  if (vars.release) await db.table("m_security_bucket").update(vars.release, { score: 0, blocked: false, reason: "released" });
  if (vars.block) await db.table("m_security_bucket").update(vars.block, { score: set.blockScore, blocked: true, reason: "manual block" });
  if (vars.seen) await db.table("m_security_event").update(vars.seen, { state: "seen" });
  if (vars.ignore) await db.table("m_security_event").update(vars.ignore, { state: "ignore" });
  const buckets = await db.query`SELECT * FROM m_security_bucket ORDER BY score DESC,last_seen DESC LIMIT 80`;
  const where = eventWhere(ctx.req.query);
  const events = await db.query`SELECT * FROM m_security_event ${where.parts.length ? sql`WHERE ${where}` : sql``} ORDER BY id DESC LIMIT 120`;
  const topIps = await db.query`SELECT ip, COUNT(*) num, MAX(time) last FROM m_security_event WHERE ip!='' GROUP BY ip ORDER BY num DESC,last DESC LIMIT 10`;
  const topPaths = await db.query`SELECT path, COUNT(*) num, MAX(time) last FROM m_security_event WHERE path!='' GROUP BY path ORDER BY num DESC,last DESC LIMIT 10`;
  const topKinds = await db.query`SELECT kind, COUNT(*) num, MAX(time) last FROM m_security_event WHERE kind!='' GROUP BY kind ORDER BY num DESC,last DESC LIMIT 10`;
  const topUa = await db.query`SELECT ua, COUNT(*) num, MAX(time) last FROM m_security_event WHERE ua!='' GROUP BY ua ORDER BY num DESC,last DESC LIMIT 10`;
  const stats = await db.row`SELECT COUNT(*) events, SUM(CASE WHEN blocked THEN 1 ELSE 0 END) blocked, SUM(CASE WHEN state='new' THEN 1 ELSE 0 END) fresh FROM m_security_event` ?? {};
  const tab = ctx.req.query.tab ?? "live";
  return html.async`<div>
    <div class=u2-flex>
      ${statusBox(app, stats)}
      <div>
        ${tabs(ctx, tab)}
        ${tab === "settings" ? settingsEditor(ctx) : ""}
        ${tab === "buckets" ? bucketTable(app, buckets) : ""}
        ${tab === "analyse" ? html`<div class=u2-flex>${topTable(ctx, "Top IPs", topIps, "ip")}${topTable(ctx, "Top Paths", topPaths, "path")}${topTable(ctx, "Top Kinds", topKinds, "kind")}${topTable(ctx, "Top Clients", topUa, "ua")}` : ""}
        ${tab === "live" ? eventTable(app, events, ctx.req.query) : ""}
      </div>
    </div>
  </div>`;
}

function statusBox(app: App, stats: Record<string, unknown>) {
  return html.async`<div class="u2-card -kpi"><div class=-head>${app.t`Status`}</div><div>
    <b>${stats.events ?? 0}</b> ${app.t`Events`}<br><b>${stats.fresh ?? 0}</b> ${app.t`new`}<br><b>${stats.blocked ?? 0}</b> ${app.t`Blocked`}<br>
    <button data-action=clearEvents u2-confirm>${app.t`Clear events`}</button>
    <button data-action=clearBuckets u2-confirm>${app.t`Clear buckets`}</button>
  </div></div>`;
}

function tabs(ctx: Ctx, active: string) {
  const u = ctx.req.url.toURL();
  const href = (tab: string) => { u.searchParams.set("tab", tab); return u.search; };
  return html`<u2-buttongroup style="margin-bottom:1rem">${["live","buckets","analyse","settings"].map(v => html`<a href="${href(v)}" class="btn ${v===active?"-active":""}">${v}</a>`)}</u2-buttongroup>`;
}

function settingsEditor(ctx: Ctx) {
  ctx.res.html.scripts.add(ctx.req.moduleUrl + "core/pub/js/SettingsEditor.mjs");
  return html`<div class=u2-card><settings-editor source="/api/core/settings/cms.backend.system.security"></settings-editor></div>`;
}

async function bucketTable(app: App, rows: Record<string, unknown>[]) {
  const [tHead, tScore, tScope, tIdent, tCount, tLast, tReason, tRelease, tBlock] = await Promise.all([
    app.t`Suspicious buckets`, app.t`Score`, app.t`Scope`, app.t`Ident`, app.t`Count`, app.t`Last`, app.t`Reason`, app.t`release`, app.t`block`,
  ]);
  return html`<div class="u2-card -table"><div class=-head>${tHead}</div><table class="u2-table -Sticky">
    <thead><tr>
      <th>${tScore}
      <th>${tScope}
      <th>${tIdent}
      <th>${tCount}
      <th>${tLast}
      <th>${tReason}
      <th>
    <tbody>${rows.map(r => html`<tr class="${r.blocked?"-blocked":""}">
      <td>${r.score}
      <td>${r.scope}
      <td><code>${r.ident}</code>
      <td>${r.count}
      <td>${u2.el.time(r.last_seen)}
      <td>${r.reason}
      <td><button data-release="${r.id}">${tRelease}</button> <button data-block="${r.id}">${tBlock}</button>`)}
  </table></div>`;
}

async function eventTable(app: App, rows: Row[], get: Record<string, string>) {
  const [tHead, tTime, tEvent, tScore, tAffected, tAction, tReason, tRequest, tStatus] = await Promise.all([
    app.t`Alarms / Requests`, app.t`Time`, app.t`Event`, app.t`Score`, app.t`Affected`, app.t`Action`, app.t`Reason`, app.t`Request`, app.t`Status`,
  ]);
  return html.async`<div class="u2-card -table"><div class=-head>${tHead}</div>
    ${eventFilter(app, get)}
    <table class="u2-table -Sticky">
      <thead><tr>
        <th>${tTime}
        <th>${tEvent}
        <th>${tScore}
        <th>${tAffected}
        <th>${tAction}
        <th>${tReason}
        <th>${tRequest}
        <th>${tStatus}
        <th>
    <tbody>${rows.map(r => html`<tr class="-${r.prio}">
      <td>${u2.el.time(r.time)}
      <td>${eventCell(r)}
      <td>${scoreCell(r)}
      <td>${bucketCell(r)}
      <td>${actionCell(r)}
      <td>${r.reason}
      <td>${requestCell(r)}
      <td>${stateCell(r)}
      <td>${eventActions(r)}`)}
  </table></div>`;
}

function eventCell(r: Row) {
  return html`${tag(r.kind || "-")}<br><small>${PRIO_LABELS[r.prio] ?? r.prio}</small>`;
}

function scoreCell(r: Row) {
  const meta = [`Conf. ${r.confidence ?? 0}`, `Severity ${r.severity ?? 0}`].join(" / ");
  return html`<b>${r.score}</b><br><small>${meta}</small>`;
}

function bucketCell(r: Row) {
  return r.scope || r.ident ? html`${tag(SCOPE_LABELS[r.scope] ?? (r.scope || "-"))}<br><code>${r.ident || "-"}</code>` : "-";
}

function actionCell(r: Row) {
  const parts = [];
  if (Number(r.blocked)) parts.push("Block");
  if (Number(r.delay_ms)) parts.push(html`${r.delay_ms}ms Delay`);
  if (Number(r.status)) parts.push(html`http ${r.status}`);
  return parts.length ? html.join(parts, "<br>") : "-";
}

function requestCell(r: Row) {
  const meta = [r.method, r.ip, r.duration_ms ? r.duration_ms + "ms" : "", bytes(r.bytes_in, "in"), bytes(r.bytes_out, "out")].filter(Boolean);
  const ids = [r.log_id ? "log " + r.log_id : "", r.usr_id ? "user " + r.usr_id : "", r.client_id ? "client " + r.client_id : ""].filter(Boolean);
  return html`<code>${r.path}</code>${meta.length ? html`<br><small>${meta.join(" · ")}</small>` : ""}${ids.length ? html`<br><small>${ids.join(" · ")}</small>` : ""}`;
}

function stateCell(r: Row) {
  return tag(STATE_LABELS[r.state] ?? r.state ?? "-");
}

function eventActions(r: Row) {
  if (r.prio === "notice") return "";
  return html`<button data-seen="${r.id}">seen</button> <button data-ignore="${r.id}">ignore</button>`;
}

function topTable(ctx: Ctx, title: string, rows: Record<string, unknown>[], key: string) {
  const u = ctx.req.url.toURL();
  const href = (q: unknown) => { u.searchParams.set("tab", "live"); u.searchParams.set("q", String(q ?? "")); return u.search; };
  return html`<div class="u2-card -table -toplist"><div class=-head>${title}</div><table class=u2-table>
    ${rows.map(r => html`<tr>
      <td>${r.num}
      <td><a href="${href(r[key])}"><code>${r[key]}</code></a>
      <td>${u2.el.time(r.last)}`)}
  </table></div>`;
}

function eventFilter(app: App, get: Record<string, string>) {
  return html.async`<form class=u2-flex>
    <input type=hidden name=tab value=live>
    <input name=q value="${get.q}" placeholder="${app.t`IP, path, reason`}">
    <select name=prio><option value="">${app.t`Severity`}${opts(["notice","warning","error"], get.prio, PRIO_LABELS)}</select>
    <select name=kind><option value="">${app.t`Event`}${opts(["attack","path-block","probe","login","load","throttle","request"], get.kind, KIND_LABELS)}</select>
    <select name=scope><option value="">${app.t`Bucket`}${opts(["ip","range","client","user","path","attack:ip","attack:range","attack:path","login:ip","login:range","login:user"], get.scope, SCOPE_LABELS)}</select>
    <select name=blocked><option value="">${app.t`Action`}${opts(["blocked","delayed"], get.blocked, ACTION_LABELS)}</select>
    <select name=state><option value="">${app.t`Status`}${opts(["new","seen","ignore"], get.state, STATE_LABELS)}</select>
    <input name=min value="${get.min}" placeholder="${app.t`min severity`}">
    <button>${app.t`filter`}</button>
  </form>`;
}

function eventWhere(get: Record<string, string>): Sql {
  const parts = [];
  if (get.prio) parts.push(sql`prio = ${get.prio}`);
  if (get.kind) parts.push(sql`kind = ${get.kind}`);
  if (get.scope) parts.push(sql`scope = ${get.scope}`);
  if (get.blocked === "blocked") parts.push(sql`blocked = ${true}`);
  if (get.blocked === "delayed") parts.push(sql.raw("delay_ms > 0"));
  if (get.state) parts.push(sql`state = ${get.state}`);
  if (get.min) parts.push(sql`severity >= ${Number(get.min) || 0}`);
  if (get.q) { const like = "%" + get.q + "%"; parts.push(sql`(ip LIKE ${like} OR path LIKE ${like} OR reason LIKE ${like} OR ident LIKE ${like})`); }
  return sql.join(parts, " AND ");
}

const PRIO_LABELS: Record<string, string> = { notice: "Info", warning: "Warning", error: "Critical" };
const KIND_LABELS: Record<string, string> = { attack: "Attack", "path-block": "Path block", probe: "Probe", login: "Login", load: "Load", throttle: "Throttle", request: "Request" };
const SCOPE_LABELS: Record<string, string> = { ip: "IP", range: "IP range", client: "Client", user: "User", path: "Path", "attack:ip": "Attack/IP", "attack:range": "Attack/Range", "attack:path": "Attack/Path", "login:ip": "Login/IP", "login:range": "Login/Range", "login:user": "Login/User" };
const STATE_LABELS: Record<string, string> = { new: "new", seen: "seen", ignore: "ignored" };
const ACTION_LABELS: Record<string, string> = { blocked: "blocked", delayed: "delayed" };

const opts = (vs: string[], active = "", labels: Record<string, string> = {}) => vs.map(v => html`<option value="${v}"${v===active?" selected":""}>${labels[v] ?? v}`);
const tag = (v: unknown) => html`<span class=u2-badge>${v}</span>`;
const bytes = (n: unknown, name: string) => Number(n) ? name + " " + humanBytes(Number(n)) : "";

function humanBytes(n: number) {
  if (n < 1024) return n + "B";
  if (n < 1024 * 1024) return Math.round(n / 1024) + "KB";
  return Math.round(n / 1024 / 1024 * 10) / 10 + "MB";
}
