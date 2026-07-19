import { html, type HtmlString, getCtx, pwHash, type App } from "../core/mod.ts";
import type { Node } from "../cms/mod.ts";
import { list, allowLoginAs } from "./parts/list.ts";
import { backend } from "../cms.backend/mod.ts";
import api from "./nodeApi.ts";

export const name = "cms.backend.users";
export const needs = ["cms.backend"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, "cms.backend.users", { en: "Users", de: "Benutzer" });
}

function render(node: Node): Promise<HtmlString | string> {
  const ctx = getCtx();
  const id = ctx.req.query.id ? Number(ctx.req.query.id) : 0;

  if (id) return renderDetail(node, id);
  return renderOverview(node);
}

async function renderOverview(node: Node): Promise<HtmlString | string> {
  const ctx = getCtx();
  const app = node.app;
  const t = app.t;
  const db = app.db;

  let addMessage: HtmlString | string = "";
  if (ctx.req.body?.csrfToken === ctx.csrfToken && "add" in ctx.req.body) {
    const email = String(ctx.req.body.email ?? "");
    const exists = email && await db.one`SELECT id FROM usr WHERE email = ${email}`;
    if (exists) {
      addMessage = await html.async`<div class=-body>${t`This e-mail address already exists!`}</div>`;
    } else {
      await db.table("usr").insert({
        active: 1,
        email: email || null,
        pw: ctx.req.body.pw ? await pwHash(String(ctx.req.body.pw)) : null,
        firstname: String(ctx.req.body.firstname ?? ""),
        lastname: String(ctx.req.body.lastname ?? ""),
      });
      ctx.res.headers.set("Location", ctx.req.url.href);
      ctx.res.status = 302;
      return "";
    }
  }

  const loginAsTh = await allowLoginAs(node, ctx) ? html.raw('<th width=20>') : "";

  const grpId = ctx.req.query.grp_id ? Number(ctx.req.query.grp_id) : 0;
  const grps = await db.query`SELECT id, name FROM grp ORDER BY name`;
  const grpOpts: Array<HtmlString | Promise<HtmlString>> = [html.async`<option value="">${t`All groups`}</option>`];
  for (const g of grps) {
    grpOpts.push(html`<option value=${g.id}${Number(g.id) === grpId ? " selected" : ""}>${g.name}</option>`);
  }

  return html.async`<div class=u2-flex>
  <div class=u2-card style="flex-grow:0">
    <div class=-head>${t`Add user`}</div>
    ${addMessage}
    <form method=post style="padding:0">
      <input hidden name=fake1>
      <input hidden name=fake2 type=password>
      <input type=hidden name=csrfToken value="${ctx.csrfToken}">
      <table class=u2-table style="white-space:nowrap">
        <tr>
          <th style="width:6em"> ${t`Email`}:
          <td> <input type=text name=email class=-new-email>
        <tr>
          <th> ${t`Password`}:
          <td> <input type=password name=pw autocomplete=new-password>
        <tr>
          <th> ${t`First name`}:
          <td> <input type=text name=firstname>
        <tr>
          <th> ${t`Last name`}:
          <td> <input type=text name=lastname>
        <tr>
          <th>
          <td> <button name=add>${t`add`}</button>
      </table>
    </form>
  </div>

  <div class=u2-card style="flex:1">
    <div class=-head> ${t`Search users`} </div>
    <div class=-body>
      <input type=search placeholder="${t`search`}..." id=usrSearch style="width:300px; max-width:100%">
      <select id=usrGrp>${html.join(await Promise.all(grpOpts))}</select>
    </div>
    <div style="overflow:auto; padding:0">
      <table class=u2-table>
        <thead>
          <tr>
            <th> ID
            <th> ${t`Name`}
            <th> ${t`Email`}
            <th> ${t`Company`}
            <th> ${t`Active`}
            <th> ${t`Sessions`}
            <th> ${t`last online`}
            ${loginAsTh}
            <th width=20>
            <th width=20>
        <tbody cms-part=list>
          ${list(node, {ctx, vars: {}})}
      </table>
    </div>
  </div>
</div>`;
}

export function backendDashboardWidget(app: App): Promise<HtmlString> {
  const db = app.db;
  const t = app.t;

  const loginRows = db.query`
    SELECT usr.email, sess.access
     FROM sess
     LEFT JOIN usr ON sess.usr_id = usr.id
     WHERE sess.usr_id IS NOT NULL AND sess.access IS NOT NULL
     ORDER BY sess.access DESC LIMIT 5`.catch(() => []).then(logins =>
    logins.length
      ? html.async`<table class="u2-table" style="white-space:nowrap;margin-top:1px">
  <thead><tr><th>${t`Recent logins`}<th>
  <tbody>${html.join(logins.map((row) => html`<tr><td>${row.email ?? "–"}<td><u2-time datetime="${new Date(Number(row.access) * 1000).toISOString()}" type=relative></u2-time>`))}
</table>`
      : html.raw(""));

  return html.async`<div style="overflow:auto; padding:0">
<table class="u2-table" style="white-space:nowrap">
  <tr><td>${t`Total`}:<td>${db.one`SELECT count(*) FROM usr`}
  <tr><td>${t`Active`}:<td>${db.one`SELECT count(*) FROM usr WHERE active = ${true}`}
</table>
${loginRows}
</div>`;
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render,
    api,
    parts: {
      list,
    },
  },
};

async function renderDetail(node: Node, id: number): Promise<HtmlString> {
  const ctx = getCtx();
  const app = node.app;
  const t = app.t;
  const db = app.db;

  const vs = await db.row`SELECT * FROM usr WHERE id = ${id}`;
  if (!vs) return html.async`<div class=u2-card><div class=-body>${t`User not found.`}</div></div>`;

  const isSuperuser = !!(await ctx.user?.get("superuser"));
  const superuserRow = isSuperuser ? html`
        <tr>
          <th> Superuser:
          <td>
            <input type=hidden name=superuser value=0>
            <input type=checkbox name=superuser value=1 ${vs.superuser ? "checked" : ""}>` : "";

  const grpRows = await db.query`SELECT grp.*, usr_grp.usr_id as has FROM grp LEFT JOIN usr_grp ON grp.id = usr_grp.grp_id AND usr_grp.usr_id = ${id} ORDER BY grp.name`;

  const grpHtml = html.join(grpRows.map((g) => html`
      <tr>
        <td>${g.name}
        <td>
          <input type=checkbox value=${g.id} ${g.has ? "checked" : ""}>`));

  return html.async`<div class=u2-flex itemid="${id}">
  <div class=u2-card style="flex:0 1 340px">
    <div class=-head>${t`User`} ${vs.id}</div>
    <div style="overflow:auto; padding:0">
      <table class="u2-table -detail">
        <tr>
          <th> ${t`Active`}:
          <td>
            <input type=hidden name=active value=0>
            <input type=checkbox name=active value=1 ${vs.active ? "checked" : ""}>
        <tr>
          <th> ${t`Email`}:
          <td> <input name=email value="${vs.email}">
        <tr>
          <th> ${t`Password`}:
          <td> <input name=pw autocomplete=new-password type=password>
        <tr>
          <th> ${t`First name`}:
          <td> <input name=firstname value="${vs.firstname}">
        <tr>
          <th> ${t`Last name`}:
          <td> <input name=lastname value="${vs.lastname}">
        <tr>
          <th> ${t`Company`}:
          <td> <input name=company value="${vs.company}">
        ${superuserRow}
      </table>
    </div>
  </div>

  <div class=u2-card style="flex:0 1 auto">
    <div class=-head>${t`Groups`}</div>
    <table class="u2-table -set_grp" style="width:auto">
      ${grpHtml}
    </table>
  </div>
</div>`;
}
