import { html, type HtmlString, getCtx, type App } from "../core/mod.ts";
import type { Node } from "../cms/mod.ts";
import { backend } from "../cms.backend/mod.ts";
import api from "./nodeApi.ts";

export const name = "cms.backend.groups";
export const needs = ["cms.backend"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Groups", de: "Gruppen" });
}

/** Options for the cms_access level (same labels as the page access widgets). */
async function accessOptions(app: App, current: number): Promise<HtmlString> {
  const t = app.t;
  const labels = [await t`no access`, await t`view`, await t`edit`, await t`administer`];
  return html.join(labels.map((l, i) => html`<option value=${i} ${i === current ? "selected" : ""}>${i} · ${l}`));
}

function render(node: Node): Promise<HtmlString> {
  const ctx = getCtx();
  const id = ctx.req.query.id ? Number(ctx.req.query.id) : 0;

  if (id) return renderDetail(node, id);
  return renderOverview(node);
}

async function renderOverview(node: Node): Promise<HtmlString> {
  const ctx = getCtx();
  const app = node.app;
  const t = app.t;
  const db = app.db;

  if (ctx.req.body?.csrfToken === ctx.csrfToken && "add" in ctx.req.body) {
    await db.table("grp").insert({
      name: String(ctx.req.body.name ?? ""),
      cms_access: Math.min(Math.max(0, Number(ctx.req.body.cms_access) || 0), 3),
    });
  }

  const usersNode = await node.cms.nodeByModule("cms.backend.users");
  const usersUrl = usersNode ? await (await usersNode.page()).url() : "";

  const rows = await db.query`
    SELECT grp.*, (SELECT count(*) FROM usr_grp WHERE usr_grp.grp_id = grp.id) AS members
    FROM grp ORDER BY grp.type, grp.name`;

  const trs: HtmlString[] = [];
  for (const vs of rows) {
    trs.push(html`<tr itemid=${String(vs.id)}>
      <td>${String(vs.id)}
      <td><a href="?id=${String(vs.id)}">${vs.name ?? ""}</a>
      <td>${vs.type ?? ""}
      <td><select name=cms_access>${await accessOptions(app, Number(vs.cms_access) || 0)}</select>
      <td style="text-align:right">${usersUrl ? html`<a href="${usersUrl}?grp_id=${String(vs.id)}">${Number(vs.members)}</a>` : Number(vs.members)}
      <td class=-delete><button class=u2-unstyle u2-confirm><u2-ico icon=delete>✕</u2-ico></button>`);
  }

  return html.async`<div class=u2-flex>
  <div class=u2-card style="flex-grow:0">
    <div class=-head>${t`Add group`}</div>
    <form method=post style="padding:0">
      <input type=hidden name=csrfToken value="${ctx.csrfToken}">
      <table class=u2-table style="white-space:nowrap">
        <tr>
          <th style="width:6em"> ${t`Name`}:
          <td> <input type=text name=name required>
        <tr>
          <th> ${t`Access`}:
          <td> <select name=cms_access>${await accessOptions(app, 0)}</select>
        <tr>
          <th>
          <td> <button name=add>${t`add`}</button>
      </table>
    </form>
  </div>

  <div class=u2-card style="flex:1">
    <div class=-head>${t`Groups`}</div>
    <div style="overflow:auto; padding:0">
      <table class=u2-table>
        <thead>
          <tr>
            <th> ID
            <th> ${t`Name`}
            <th> ${t`Type`}
            <th> ${t`Access`}
            <th> ${t`Members`}
            <th width=20>
        <tbody>
          ${html.join(trs)}
      </table>
    </div>
  </div>
</div>`;
}

async function renderDetail(node: Node, id: number): Promise<HtmlString> {
  const app = node.app;
  const t = app.t;
  const db = app.db;

  const vs = await db.row`SELECT * FROM grp WHERE id = ${id}`;
  if (!vs) return html.async`<div class=u2-card><div class=-body>${t`Group not found.`}</div></div>`;

  const usersNode = await node.cms.nodeByModule("cms.backend.users");
  const usersUrl = usersNode ? await (await usersNode.page()).url() : "";

  const members = await db.query`
    SELECT usr.id, usr.email, usr.firstname, usr.lastname
    FROM usr JOIN usr_grp ON usr.id = usr_grp.usr_id
    WHERE usr_grp.grp_id = ${id} ORDER BY usr.lastname, usr.firstname`;

  const memberRows: HtmlString[] = [];
  for (const m of members) {
    const label = [m.firstname, m.lastname].filter(Boolean).join(" ") || m.email || m.id;
    memberRows.push(html`<tr>
      <td>${usersUrl ? html`<a href="${usersUrl}?id=${String(m.id)}">${String(label)}</a>` : String(label)}
      <td>${m.email ?? ""}
      <td><button class="u2-unstyle -remove" data-usr=${String(m.id)} u2-confirm><u2-ico icon=delete>✕</u2-ico></button>`);
  }

  return html.async`<div class=u2-flex itemid="${String(id)}">
  <div class=u2-card style="flex:0 1 340px">
    <div class=-head>${t`Group`} ${String(vs.id)}</div>
    <div style="overflow:auto; padding:0">
      <table class="u2-table -detail">
        <tr>
          <th> ${t`Name`}:
          <td> <input name=name value="${vs.name ?? ""}">
        <tr>
          <th> ${t`Type`}:
          <td> <input name=type value="${vs.type ?? ""}">
        <tr>
          <th> ${t`Access`}:
          <td> <select name=cms_access>${await accessOptions(app, Number(vs.cms_access) || 0)}</select>
      </table>
    </div>
  </div>

  <div class="u2-card -members" style="flex:0 1 auto">
    <div class=-head>${t`Members`} (${members.length})</div>
    <table class=u2-table style="width:auto">
      ${html.join(memberRows)}
    </table>
    <form class=-body data-add-member>
      <input type=email name=email placeholder="${t`Email`}..." required>
      <button>${t`add`}</button>
    </form>
  </div>
</div>`;
}

export function backendDashboardWidget(app: App): Promise<HtmlString> {
  return html.async`<div class=-body>
    <b>${app.db.one`SELECT count(*) FROM grp`}</b> ${app.t`groups`}<br>
    <small>${app.db.one`SELECT count(*) FROM grp WHERE cms_access > 0`} ${app.t`with page access`}</small>
  </div>`;
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render,
    api,
  },
};
