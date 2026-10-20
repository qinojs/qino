import { getCtx, html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { badge, money, rowLink } from "@qino/qino/cms.backend.superuser.fin";
import { nameOf } from "@qino/qino/fin";
import { blockers, domains, get, running, subscriptionsBy } from "@qino/qino/fin.hosting";
import { subscriptions } from "@qino/qino/fin.subscription";

import type { App, HtmlString, Row } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

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

/** Per period: "CHF 240.00 / year". */
const price = (app: App, s: Row) =>
  html.async`${money(s.amount, s.currencyCode)} / ${Number(s.count) > 1 ? `${s.count} ` : ""}${s.unit === "month" ? app.t`month` : app.t`year`}`;

/** What a domain is billed by, or — a customer's domain, an alias too, without a running subscription — that it is not. */
function billing(app: App, d: Row, subs: Row[]) {
  const live = subs.filter(running);
  if (live.length) return html.async`${live.map((s) => html.async`<div>${s.label} <small>${price(app, s)}</small></div>`)}`;
  return d.usr_id == null ? "" : badge(app.t`not billed`, "--orange");
}

/** The name, or "↳ alias" below its domain. */
const nameCell = (pageUrl: string, d: Row) =>
  html`${d.alias_of ? html`<small>↳</small> ` : ""}<a href="${backend.toUrl(pageUrl, { domain: d.name })}">${d.name}</a>`;

/** All domains with owner, aliases and what they are billed by; a new one. */
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
  <div class=u2-card style="flex:1 1 40rem; min-width:0">
    <div class=-head>${t`Domains`} <small>${rows.length}</small></div>
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
        <th>${t`Billed by`}
      <tbody>${rows.map((d) => html.async`<tr>
        <td style="white-space:nowrap">${nameCell(pageUrl, d)}
        <td>${d.usr_id == null ? "" : rowLink(node, "cms.backend.superuser.fin.party", "usr", d.usr_id, names.get(Number(d.usr_id)))}
        <td>${d.registrar}
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
        ${t`Registrar`} <input name=registrar>
      </u2-fields>
      <button>${t`Add`}</button>
    </form>
  </div>
</div>`;
}

/** One domain: owner, alias, registrar; its aliases; the subscriptions it is billed by; removing it. */
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
    aliases: t`It has aliases.`,
    running: t`Subscriptions still run for it.`,
    unpaid: t`An invoice of its subscriptions is unpaid.`,
  };
  const held = (await Promise.all(why.map((w) => reasons[w]))).join(" ");
  return html.async`<div class=u2-flex>
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head><a href="${pageUrl}">${t`Domains`}</a> › ${d.name}</div>
    <form data-save="${d.name}">
      <u2-fields>
        ${d.alias_of ? "" : html.async`${t`Customer`} ${customerSelect(users, d.usr_id, "—")}`}
        ${t`Alias of`} ${aliasSelect(all, d.alias_of, String(d.name))}
        ${t`Registrar`} <input name=registrar value="${d.registrar}">
      </u2-fields>
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
      <td>${rowLink(node, "cms.backend.superuser.fin.subscription", "subscription", s.id, String(s.label))}
      <td style="text-align:end">${price(app, s)}
      <td>${running(s) ? s.next : badge(t`ended`)}
      <td>${running(s) ? html.async`<button data-unlink="${s.id}">${t`Unlink`}</button>` : ""}`)}
    </table>` : html.async`<p>${t`No subscriptions yet`}`}
    ${free.length ? html.async`<form data-link="${d.name}">
      <select name=subscription>${free.map((s) => html`<option value="${s.id}">${s.label}`)}</select>
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
  const [list, subs] = await Promise.all([domains(app), subscriptionsBy(app)]);
  const unbilled = list.filter((d) => d.usr_id != null && !(subs.get(String(d.name)) ?? []).some(running));
  return html.async`<div><b>${list.length}</b> ${app.t`domains`}${unbilled.length
    ? html.async` · ${badge(html.async`${unbilled.length} ${app.t`not billed`}`, "--orange")}`
    : ""}</div>`;
}
