import { hee, getCtx, pwHash, type App } from "../core/mod.ts";
import type { Node } from "../cms/mod.ts";
import { list } from "./parts/list.ts";
import { backend } from "../cms.backend/mod.ts";
import api from "./nodeApi.ts";

export const name = "cms.backend.users";
export const needs = ["cms.backend"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, "cms.backend.users", { en: "Users", de: "Benutzer" });
}

function render(node: Node): Promise<string> {
  const ctx = getCtx();
  const id = ctx.get.id ? Number(ctx.get.id) : 0;

  if (id) return renderDetail(node, id);
  return renderOverview(node);
}

async function renderOverview(node: Node): Promise<string> {
  const ctx = getCtx();
  const app = node.app;
  const db = app.db;

  let addMessage = "";
  if ("add" in ctx.post && ctx.post.qgToken === ctx.token) {
    const email = String(ctx.post.email ?? "");
    const exists = email && await db.one("SELECT id FROM usr WHERE email = ?", [email]);
    if (exists) {
      addMessage = `<div class=-body>${await app.t`This e-mail address already exists!`}</div>`;
    } else {
      await db.table("usr").insert({
        active: 1,
        email: email || null,
        pw: await pwHash(String(ctx.post.pw ?? "")),
        firstname: String(ctx.post.firstname ?? ""),
        lastname: String(ctx.post.lastname ?? ""),
      });
    }
  }

  const allowLoginAs = !!(node.settings.allow_login_as()) || !!(await ctx.user?.get("superuser"));
  const loginAsTh = allowLoginAs ? '<th width=20>' : "";

  return `<div class=u2-flex>
  <div class=u2-card style="flex-grow:0">
    <div class=-head>${await app.t`Add user`}</div>
    ${addMessage}
    <form method=post style="padding:0">
      <input hidden name=fake1>
      <input hidden name=fake2 type=password>
      <input type=hidden name=qgToken value="${hee(ctx.token)}">
      <table class=u2-table>
        <tr>
          <th style="width:6em"> ${await app.t`Email`}:
          <td> <input type=text name=email class=-new-email>
        <tr>
          <th> ${await app.t`Password`}:
          <td> <input type=password name=pw autocomplete=new-password>
        <tr>
          <th> ${await app.t`First name`}:
          <td> <input type=text name=firstname>
        <tr>
          <th> ${await app.t`Last name`}:
          <td> <input type=text name=lastname>
        <tr>
          <th>
          <td> <button name=add>${await app.t`add`}</button>
      </table>
    </form>
  </div>

  <div class=u2-card style="flex:1">
    <div class=-head> ${await app.t`Search users`} </div>
    <div class=-body>
      <input type=search placeholder="${await app.t`search`}..." id=usrSearch style="width:300px; max-width:100%">
    </div>
    <div style="overflow:auto; padding:0">
      <table class=u2-table>
        <thead>
          <tr>
            <th> ID
            <th> ${await app.t`Name`}
            <th> ${await app.t`Email`}
            <th> ${await app.t`Company`}
            <th> ${await app.t`Active`}
            <th> ${await app.t`Sessions`}
            <th> ${await app.t`last online`}
            ${loginAsTh}
            <th width=20>
            <th width=20>
        <tbody cms-part=list>
          ${ await list(node, {ctx, vars: {}}) }
      </table>
    </div>
  </div>
</div>`;
}

export async function backendDashboardWidget(app: App): Promise<string> {
  const db = app.db;
  const total  = Number(await db.one("SELECT count(*) FROM usr"));
  const active = Number(await db.one("SELECT count(*) FROM usr WHERE active = 1"));

  const logins = await db.all(
    `SELECT usr.email, sess.access
     FROM sess
     LEFT JOIN usr ON sess.usr_id = usr.id
     WHERE sess.usr_id IS NOT NULL AND sess.access IS NOT NULL
     ORDER BY sess.access DESC LIMIT 5`
  ).catch(() => []);

  let loginRows = "";
  for (const row of logins) {
    const iso = new Date(Number(row.access) * 1000).toISOString();
    loginRows += `<tr><td>${hee(row.email ?? "–")}<td><u2-time datetime="${iso}" type=relative></u2-time>`;
  }

  return `<div style="overflow:auto; padding:0">
<table class="u2-table" style="white-space:nowrap">
  <tr><td>${await app.t`Total`}:<td>${hee(String(total))}
  <tr><td>${await app.t`Active`}:<td>${hee(String(active))}
</table>
${loginRows ? `<table class="u2-table" style="white-space:nowrap;margin-top:1px">
  <thead><tr><th>${await app.t`Recent logins`}<th>
  <tbody>${loginRows}
</table>` : ""}
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

async function renderDetail(node: Node, id: number): Promise<string> {
  const ctx = getCtx();
  const app = node.app;
  const db = app.db;

  const vs = await db.row("SELECT * FROM usr WHERE id = ?", [id]);
  if (!vs) return `<div class=u2-card><div class=-body>${await app.t`User not found.`}</div></div>`;

  const isSuperuser = !!(await ctx.user?.get("superuser"));
  const superuserRow = isSuperuser ? `
        <tr>
          <th> Superuser:
          <td>
            <input type=hidden name=superuser value=0>
            <input type=checkbox name=superuser value=1 ${vs.superuser ? "checked" : ""}>` : "";

  const grpRows = await db.all(
    "SELECT grp.*, usr_grp.usr_id as has FROM grp LEFT JOIN usr_grp ON grp.id = usr_grp.grp_id AND usr_grp.usr_id = ? ORDER BY grp.name",
    [id]
  );

  let grpHtml = "";
  for (const g of grpRows) {
    grpHtml += `
      <tr>
        <td>${hee(g.name)}
        <td>
          <input type=checkbox value=${hee(g.id)} ${g.has ? "checked" : ""}>`;
  }

  return `<div class=u2-flex itemid="${hee(String(id))}">
  <div class=u2-card style="flex:0 1 340px">
    <div class=-head>${await app.t`User`} ${hee(String(vs.id))}</div>
    <div style="overflow:auto; padding:0">
      <table class="u2-table -detail">
        <tr>
          <th> ${await app.t`Active`}:
          <td>
            <input type=hidden name=active value=0>
            <input type=checkbox name=active value=1 ${vs.active ? "checked" : ""}>
        <tr>
          <th> ${await app.t`Email`}:
          <td> <input name=email value="${hee(vs.email ?? "")}">
        <tr>
          <th> ${await app.t`Password`}:
          <td> <input name=pw autocomplete=new-password type=password>
        <tr>
          <th> ${await app.t`First name`}:
          <td> <input name=firstname value="${hee(vs.firstname ?? "")}">
        <tr>
          <th> ${await app.t`Last name`}:
          <td> <input name=lastname value="${hee(vs.lastname ?? "")}">
        <tr>
          <th> ${await app.t`Company`}:
          <td> <input name=company value="${hee(vs.company ?? "")}">
        ${superuserRow}
      </table>
    </div>
  </div>

  <div class=u2-card style="flex:0 1 auto">
    <div class=-head>${await app.t`Groups`}</div>
    <table class="u2-table -set_grp" style="width:auto">
      ${grpHtml}
    </table>
  </div>
</div>`;
}
