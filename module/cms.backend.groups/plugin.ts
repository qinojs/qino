import { hee, getCtx, type App } from "../core/mod.ts";
import type { Node } from "../cms/mod.ts";
import { backend } from "../cms.backend/mod.ts";
import api from "./nodeApi.ts";

export const name = "cms.backend.groups";
export const needs = ["cms.backend"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Groups", de: "Gruppen" });
}

/** Options for the cms_access level (same labels as the page access widgets). */
async function accessOptions(app: App, current: number): Promise<string> {
  const labels = [await app.t`no access`, await app.t`view`, await app.t`edit`, await app.t`administer`];
  return labels.map((l, i) => `<option value=${i} ${i === current ? "selected" : ""}>${i} · ${l}`).join("");
}

function render(node: Node): Promise<string> {
  const ctx = getCtx();
  const id = ctx.req.query.id ? Number(ctx.req.query.id) : 0;

  if (id) return renderDetail(node, id);
  return renderOverview(node);
}

async function renderOverview(node: Node): Promise<string> {
  const ctx = getCtx();
  const app = node.app;
  const db = app.db;

  if (ctx.req.body?.csrfToken === ctx.csrfToken && "add" in ctx.req.body) {
    await db.table("grp").insert({
      name: String(ctx.req.body.name ?? ""),
      cms_access: Math.min(Math.max(0, Number(ctx.req.body.cms_access) || 0), 3),
    });
  }

  const usersNode = await app.cms.nodeByModule("cms.backend.users");
  const usersUrl = usersNode ? await (await usersNode.page()).url() : "";

  const rows = await db.query`
    SELECT grp.*, (SELECT count(*) FROM usr_grp WHERE usr_grp.grp_id = grp.id) AS members
    FROM grp ORDER BY grp.type, grp.name`;

  let trs = "";
  for (const vs of rows) {
    trs += `<tr itemid=${hee(String(vs.id))}>
      <td>${hee(String(vs.id))}
      <td><a href="?id=${hee(String(vs.id))}">${hee(vs.name ?? "")}</a>
      <td>${hee(vs.type ?? "")}
      <td><select name=cms_access>${await accessOptions(app, Number(vs.cms_access) || 0)}</select>
      <td style="text-align:right">${usersUrl ? `<a href="${hee(usersUrl)}?grp_id=${hee(String(vs.id))}">${Number(vs.members)}</a>` : Number(vs.members)}
      <td class=-delete><button class=u2-unstyle u2-confirm><u2-ico icon=delete>✕</u2-ico></button>`;
  }

  return `<div class=u2-flex>
  <div class=u2-card style="flex-grow:0">
    <div class=-head>${await app.t`Add group`}</div>
    <form method=post style="padding:0">
      <input type=hidden name=csrfToken value="${hee(ctx.csrfToken)}">
      <table class=u2-table style="white-space:nowrap">
        <tr>
          <th style="width:6em"> ${await app.t`Name`}:
          <td> <input type=text name=name required>
        <tr>
          <th> ${await app.t`Access`}:
          <td> <select name=cms_access>${await accessOptions(app, 0)}</select>
        <tr>
          <th>
          <td> <button name=add>${await app.t`add`}</button>
      </table>
    </form>
  </div>

  <div class=u2-card style="flex:1">
    <div class=-head>${await app.t`Groups`}</div>
    <div style="overflow:auto; padding:0">
      <table class=u2-table>
        <thead>
          <tr>
            <th> ID
            <th> ${await app.t`Name`}
            <th> ${await app.t`Type`}
            <th> ${await app.t`Access`}
            <th> ${await app.t`Members`}
            <th width=20>
        <tbody>
          ${trs}
      </table>
    </div>
  </div>
</div>`;
}

async function renderDetail(node: Node, id: number): Promise<string> {
  const app = node.app;
  const db = app.db;

  const vs = await db.row`SELECT * FROM grp WHERE id = ${id}`;
  if (!vs) return `<div class=u2-card><div class=-body>${await app.t`Group not found.`}</div></div>`;

  const usersNode = await app.cms.nodeByModule("cms.backend.users");
  const usersUrl = usersNode ? await (await usersNode.page()).url() : "";

  const members = await db.query`
    SELECT usr.id, usr.email, usr.firstname, usr.lastname
    FROM usr JOIN usr_grp ON usr.id = usr_grp.usr_id
    WHERE usr_grp.grp_id = ${id} ORDER BY usr.lastname, usr.firstname`;

  let memberRows = "";
  for (const m of members) {
    const label = [m.firstname, m.lastname].filter(Boolean).join(" ") || m.email || m.id;
    memberRows += `<tr>
      <td>${usersUrl ? `<a href="${hee(usersUrl)}?id=${hee(String(m.id))}">${hee(String(label))}</a>` : hee(String(label))}
      <td>${hee(m.email ?? "")}
      <td><button class="u2-unstyle -remove" data-usr=${hee(String(m.id))} u2-confirm><u2-ico icon=delete>✕</u2-ico></button>`;
  }

  return `<div class=u2-flex itemid="${hee(String(id))}">
  <div class=u2-card style="flex:0 1 340px">
    <div class=-head>${await app.t`Group`} ${hee(String(vs.id))}</div>
    <div style="overflow:auto; padding:0">
      <table class="u2-table -detail">
        <tr>
          <th> ${await app.t`Name`}:
          <td> <input name=name value="${hee(vs.name ?? "")}">
        <tr>
          <th> ${await app.t`Type`}:
          <td> <input name=type value="${hee(vs.type ?? "")}">
        <tr>
          <th> ${await app.t`Access`}:
          <td> <select name=cms_access>${await accessOptions(app, Number(vs.cms_access) || 0)}</select>
      </table>
    </div>
  </div>

  <div class="u2-card -members" style="flex:0 1 auto">
    <div class=-head>${await app.t`Members`} (${members.length})</div>
    <table class=u2-table style="width:auto">
      ${memberRows}
    </table>
    <form class=-body data-add-member>
      <input type=email name=email placeholder="${await app.t`Email`}..." required>
      <button>${await app.t`add`}</button>
    </form>
  </div>
</div>`;
}

export async function backendDashboardWidget(app: App): Promise<string> {
  const total = Number(await app.db.one`SELECT count(*) FROM grp`);
  const access = Number(await app.db.one`SELECT count(*) FROM grp WHERE cms_access > 0`);
  return `<div class=-body>
    <b>${total}</b> ${await app.t`groups`}<br>
    <small>${access} ${await app.t`with page access`}</small>
  </div>`;
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render,
    api,
  },
};
