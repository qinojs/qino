import { getCtx, html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { badge, money, rowLink } from "@qino/qino/cms.backend.superuser.fin";
import { nameOf } from "@qino/qino/fin";
import { billable, blockers, domains, get, hosts, KINDS, kindOf, open, registrars, running, subscriptionsBy } from "@qino/qino/fin.hosting";
import { subscriptions } from "@qino/qino/fin.subscription";

import type { App, HtmlString, Row } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Kind } from "@qino/qino/fin.hosting";

const selected = (yes: boolean) => yes ? html.raw(" selected") : "";

export function render(node: Node): Promise<HtmlString> {
  const url = getCtx().req.url.toURL();
  const name = url.searchParams.get("domain");
  return name ? detail(node, name) : overview(node, url);
}

const customers = (app: App) =>
  app.db.query`SELECT id, given_name, family_name, organization FROM usr ORDER BY organization, family_name, given_name`;

function customerSelect(users: Row[], current: unknown, empty: string | Promise<string>, name = "usrId") {
  return html.async`<select name=${name}><option value="">${empty}${users.map((u) =>
    html`<option value="${u.id}"${selected(Number(u.id) === Number(current))}>${nameOf(u)}`)}</select>`;
}

function aliasSelect(all: Row[], current: unknown, except = "") {
  return html.async`<select name=aliasOf><option value="">—${all.filter((d) => !d.alias_of && d.name !== except).map((d) =>
    html`<option${selected(d.name === current)}>${d.name}`)}</select>`;
}

/** What a subscription is for, in a word: domain, hosting, or other. */
const kindWord = (app: App, kind: Kind | undefined) =>
  kind === "domain" ? app.t`Domain` : kind === "hosting" ? app.t`Hosting` : app.t`Other`;

/** Per period: "CHF 240.00 / year". */
const price = (app: App, s: Row) =>
  html.async`${money(s.amount, s.currencyCode)} / ${Number(s.count) > 1 ? `${s.count} ` : ""}${s.unit === "month" ? app.t`month` : app.t`year`}`;

/** What a domain is billed by, each subscription with what it is for; what we bill for (`billable`)
 *  without a running subscription for it; what is free. */
function billing(app: App, d: Row, subs: Row[]) {
  const live = subs.filter(running);
  const unbilled = billable(d).filter((kind) => !live.some((s) => kindOf(s) === kind));
  return html.async`${live.map((s) => html.async`<div><small>${kindWord(app, kindOf(s))}</small> ${s.label} <small>${price(app, s)}</small></div>`)}
    ${unbilled.map((kind) => badge(html.async`${kindWord(app, kind)} ${app.t`not billed`}`, "--orange"))}
    ${KINDS.filter((kind) => d[`${kind}_free`]).map((kind) => badge(html.async`${kindWord(app, kind)} ${app.t`free`}`))}`;
}

const checkbox = (name: string, label: string | Promise<string>, title: string | Promise<string>, checked: unknown) =>
  html.async`<label title="${title}"><input type=checkbox name=${name} value=1${checked ? html.raw(" checked") : ""}> ${label}</label>`;

/** The fields of a domain: where it is registered and hosted, each free or not; an alias has no host. */
const placeFields = (app: App, d: Row | undefined) => html.async`
  ${app.t`Registrar`} <input name=registrar value="${d?.registrar ?? ""}">
  <span></span> ${checkbox("domainFree", app.t`Domain free`, app.t`Its registration is billed for nothing: ours, or given`, d?.domain_free)}
  ${d?.alias_of ? "" : html.async`${app.t`Host`} <input name=host value="${d?.host ?? ""}">
  <span></span> ${checkbox("hostingFree", app.t`Hosting free`, app.t`Its hosting is billed for nothing: ours, or given`, d?.hosting_free)}`}`;

/** What is still to do — domains we bill for without a customer, or a customer's without a
 *  subscription for what we bill —, and the sources' sync; nothing but the sync when all is done. */
async function openCard(node: Node, pageUrl: string): Promise<HtmlString> {
  const app = node.app;
  const t = app.t;
  const [todo, from] = await Promise.all([open(app), Promise.all([registrars(app), hosts(app)])]);
  const names = from.flat().map((s) => s.name);
  return html.async`<div class=u2-card style="flex:1 1 100%">
    <div class=-head>${t`To do`} <small>${todo.length}</small>
      ${names.length ? html.async`<button data-sync style="margin-left:auto">${t`Sync`} <small>${names.join(", ")}</small></button>` : ""}</div>
    ${todo.length ? html.async`<table class=u2-table>${todo.map(({ domain, missing, kind }) => html.async`<tr>
      <td style="white-space:nowrap">${nameCell(pageUrl, domain)}
      <td>${missing === "customer" ? badge(t`no customer`, "--red") : badge(html.async`${kindWord(app, kind)} ${t`not billed`}`, "--orange")}
      <td>${kind === "hosting" ? domain.host : domain.registrar}
      <td>${kind !== "hosting" && domain.expires ? html.async`<small>${t`until`} ${String(domain.expires).slice(0, 10)}</small>` : ""}`)}
    </table>` : html.async`<p>${t`Every domain we register or host has a customer and is billed.`}`}
  </div>`;
}

/** The name, or "↳ alias" below its domain. */
const nameCell = (pageUrl: string, d: Row) =>
  html`${d.alias_of ? html`<small>↳</small> ` : ""}<a href="${backend.toUrl(pageUrl, { domain: d.name })}">${d.name}</a>`;

/** All domains with owner, registrar, host and what they are billed by; a new one. */
async function overview(node: Node, url: URL): Promise<HtmlString> {
  const app = node.app;
  const t = app.t;
  const pageUrl = await (await node.page()).url();
  const usr = Number(url.searchParams.get("usr")) || undefined;
  const search = (url.searchParams.get("search") ?? "").trim().toLowerCase();
  const [all, subs, users] = await Promise.all([domains(app, usr), subscriptionsBy(app, usr), customers(app)]);
  const names = new Map(users.map((u) => [Number(u.id), nameOf(u)]));
  const rows = search ? all.filter((d) => String(d.name).includes(search)) : all;
  return html.async`<div class=u2-flex>
  ${openCard(node, pageUrl)}
  <div class=u2-card style="flex:1 1 40rem; min-width:0">
    <div class=-head>${t`Domains`} <small>${rows.length}</small>
      <button data-prune style="margin-left:auto" u2-confirm="${t`Remove every domain without subscription, alias, hosting or registrar sync?`}">${t`Remove unlinked`}</button></div>
    <form>
      <input type=search name=search value="${search}" placeholder="${t`Domain`}">
      ${customerSelect(users, usr, t`All customers`, "usr")}
      <button>${t`Filter`}</button>
    </form>
    ${rows.length ? html.async`<div style="overflow:auto; max-height:70vh; padding:0">
      <table class=u2-table>
      <thead><tr>
        <th>${t`Domain`}
        <th>${t`Customer`}
        <th>${t`Registrar`}
        <th>${t`until`}
        <th>${t`Host`}
        <th>${t`Billed by`}
      <tbody>${rows.map((d) => html.async`<tr>
        <td style="white-space:nowrap">${nameCell(pageUrl, d)}
        <td>${d.usr_id == null ? "" : rowLink(node, "cms.backend.superuser.fin.party", "usr", d.usr_id, names.get(Number(d.usr_id)))}
        <td>${d.registrar}
        <td style="white-space:nowrap">${d.expires ? String(d.expires).slice(0, 10) : ""}
        <td>${d.host}
        <td>${billing(app, d, subs.get(String(d.name)) ?? [])}`)}
    </table></div>` : html.async`<p>${t`No domains yet`}`}
  </div>
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head>${t`New domain`}</div>
    <form data-save>
      <u2-fields>
        ${t`Domain`} <input name=name required placeholder="example.ch">
        ${t`Customer`} ${customerSelect(users, usr, "—")}
        ${t`Alias of`} ${aliasSelect(all, "")}
        ${placeFields(app, undefined)}
      </u2-fields>
      <button>${t`Add`}</button>
    </form>
  </div>
</div>`;
}

/** One domain: owner, alias, registrar, host; its aliases; the subscriptions it is billed by; removing it. */
async function detail(node: Node, name: string): Promise<HtmlString> {
  const app = node.app;
  const t = app.t;
  const pageUrl = await (await node.page()).url();
  const d = await get(app, name);
  if (!d) return html.async`<div class=u2-card><div>${t`No domain`} ${name}</div></div>`;
  const usrId = d.usr_id == null ? undefined : Number(d.usr_id);
  const [all, users, by, why, monitor] = await Promise.all([
    domains(app),
    customers(app),
    subscriptionsBy(app),
    blockers(app, String(d.name)),
    backend.toModuleUrl(node, "cms.backend.domain_monitor"),
  ]);
  const subs = by.get(String(d.name)) ?? [];
  // the owner's running subscriptions that are for nothing yet
  const free = usrId == null ? [] : (await subscriptions(app, usrId)).filter((s) => !s.ref && running(s));
  const aliases = all.filter((a) => a.alias_of === d.name);
  const owner = users.find((u) => Number(u.id) === usrId);
  const monitorUrl = monitor({ domain: d.name });
  const reasons: Record<string, Promise<string>> = {
    synced: t`A sync brings it back.`,
    aliases: t`It has aliases.`,
    running: t`Subscriptions still run for it.`,
    unpaid: t`An invoice of its subscriptions is unpaid.`,
  };
  const held = (await Promise.all(why.map((w) => reasons[w]))).join(" ");
  const kinds = d.alias_of ? ["domain" as const] : KINDS;
  return html.async`<div class=u2-flex>
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head><a href="${pageUrl}">${t`Domains`}</a> › ${d.name}</div>
    <form data-save="${d.name}">
      <u2-fields>
        ${d.alias_of ? "" : html.async`${t`Customer`} ${customerSelect(users, d.usr_id, "—")}`}
        ${t`Alias of`} ${aliasSelect(all, d.alias_of, String(d.name))}
        ${placeFields(app, d)}
      </u2-fields>
      ${d.expires ? html.async`<p><small>${t`Registered until`} ${String(d.expires).slice(0, 10)}</small>` : ""}
      <button>${t`Save`}</button>
    </form>
    <p>
      <a href="https://${d.name}/" target=_blank rel=noopener>${t`Open`}</a>
      ${monitorUrl ? html.async` · <a href="${monitorUrl}">${t`Domain monitor`}</a>` : ""}
      ${owner ? html.async` · ${rowLink(node, "cms.backend.superuser.fin.party", "usr", usrId, nameOf(owner))}` : ""}
    </p>
    ${aliases.length ? html.async`<p>${t`Aliases`}: ${html.join(aliases.map((a) => nameCell(pageUrl, a)), ", ")}` : ""}
    ${why.length
      ? html.async`<p><small>${t`It cannot be removed:`} ${held}</small>`
      : html.async`<button data-remove="${d.name}" u2-confirm="${t`Remove this domain?`}">${t`Remove`}</button>`}
  </div>
  <div class=u2-card style="flex:0 1 auto" data-domain="${d.name}">
    <div class=-head>${t`Billed by`}</div>
    ${subs.length ? html.async`<table class=u2-table style="white-space:nowrap">${subs.map((s) => html.async`<tr>
      <td>${kindWord(app, kindOf(s))}
      <td>${rowLink(node, "cms.backend.superuser.fin.subscription", "subscription", s.id, String(s.label))}
      <td style="text-align:end">${price(app, s)}
      <td>${running(s) ? s.next : badge(t`ended`)}
      <td>${running(s) ? html.async`<button data-unlink="${s.id}">${t`Unlink`}</button>` : ""}`)}
    </table>` : html.async`<p>${t`No subscriptions yet`}`}
    ${free.length ? html.async`<form data-link="${d.name}">
      <select name=subscription>${free.map((s) => html`<option value="${s.id}">${s.label}`)}</select>
      <select name=kind>${kinds.map((k) => html.async`<option value=${k}>${kindWord(app, k)}`)}<option value="">${t`Other`}</select>
      <button>${t`Link`}</button>
    </form>` : ""}
  </div>
</div>`;
}

/** A customer's domains, as card on their page (`backendRowWidget`); "" without any. */
export async function userDomains(app: App, id: unknown, page: Node): Promise<HtmlString | string> {
  const usrId = Number(id);
  const [list, subs] = await Promise.all([domains(app, usrId), subscriptionsBy(app, usrId)]);
  if (!list.length) return "";
  const pageUrl = await page.url();
  return html.async`<table class=u2-table>${list.map((d) => html.async`<tr>
    <td style="white-space:nowrap">${nameCell(pageUrl, d)}
    <td>${billing(app, d, subs.get(String(d.name)) ?? [])}`)}
  </table>`;
}

/** How many domains there are, and how many of a customer are billed by nothing. */
export async function widget(app: App): Promise<HtmlString> {
  const list = await domains(app);
  const todo = await open(app);
  return html.async`<div><b>${list.length}</b> ${app.t`domains`}${todo.length
    ? html.async` · ${badge(html.async`${todo.length} ${app.t`to do`}`, "--orange")}`
    : ""}</div>`;
}
