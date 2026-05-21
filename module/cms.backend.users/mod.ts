// Port of cms.backend.users/index.php + overview.php + detail.php
// deno-lint-ignore-file no-explicit-any

import { hee } from "../core/lib/util.ts"
import { getCtx } from "../core/lib/RequestContext.ts";
import { pwHash } from "../core/lib/auth.ts";
import type { Node } from "../cms/lib/Node.ts";
import type { App } from "../core/server.ts";
import { list } from "./parts/list.ts";
import { backend } from "../cms.backend/mod.ts";
import pageApi from "./page_api.ts";

export const name = "cms.backend.users";
export const needs = ["cms.backend"];

// Port of cms.backend.users/install.php
export async function install({ app }: { app: App }): Promise<void> {
  const P = await backend.install(app, "cms.backend.users");
  if (P) {
    await P.title("en", "Users");
    await P.title("de", "Benutzer");
  }
}

function render(node: Node): Promise<string> {
  const ctx = getCtx();
  const id = ctx.get.id ? Number(ctx.get.id) : 0;

  if (id) return renderDetail(node, id);
  return renderOverview(node);
}

async function renderOverview(node: Node): Promise<string> {
  const ctx = getCtx();
  const db = node.app.db;

  let addMessage = "";
  if ("add" in ctx.post && ctx.post.qgToken === ctx.token) {
    const email = String(ctx.post.email ?? "");
    const exists = email && await db.one("SELECT id FROM usr WHERE email = ?", [email]);
    if (exists) {
      addMessage = '<div class=-body>Die E-Mail-Adresse existiert bereits!</div>';
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
    <div class=-head>Benutzer hinzufügen</div>
    ${addMessage}
    <form method=post style="padding:0">
      <input hidden name=fake1>
      <input hidden name=fake2 type=password>
      <input type=hidden name=qgToken value="${hee(ctx.token)}">
      <table class=u2-table>
        <tr>
          <th style="width:6em"> Email:
          <td> <input type=text name=email class=-new-email>
        <tr>
          <th> Passwort:
          <td> <input type=password name=pw autocomplete=new-password>
        <tr>
          <th> Vorname:
          <td> <input type=text name=firstname>
        <tr>
          <th> Nachname:
          <td> <input type=text name=lastname>
        <tr>
          <th>
          <td> <button name=add>hinzufügen</button>
      </table>
    </form>
  </div>

  <div class=u2-card style="flex:1">
    <div class=-head> Benutzer suchen </div>
    <div class=-body>
      <input type=search placeholder="suchen..." id=usrSearch style="width:300px; max-width:100%">
    </div>
    <div style="overflow:auto; padding:0">
      <table class=u2-table>
        <thead>
          <tr>
            <th> ID
            <th> Name
            <th> Email
            <th> Firma
            <th> Active
            <th> Sessions
            <th> zuletzt online
            ${loginAsTh}
            <th width=20>
            <th width=20>
        <tbody data-part=list>
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
  <tr><td>Gesamt:<td>${hee(String(total))}
  <tr><td>Aktiv:<td>${hee(String(active))}
</table>
${loginRows ? `<table class="u2-table" style="white-space:nowrap;margin-top:1px">
  <thead><tr><th>Letzte Logins<th>
  <tbody>${loginRows}
</table>` : ""}
</div>`;
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    render,
    pageApi,
    parts: {
      list,
    },
  },
};

async function renderDetail(node: Node, id: number): Promise<string> {
  const ctx = getCtx();
  const db = node.app.db;

  const vs = await db.row("SELECT * FROM usr WHERE id = ?", [id]);
  if (!vs) return '<div class=u2-card><div class=-body>Benutzer nicht gefunden.</div></div>';

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
    <div class=-head>Benutzer ${hee(String(vs.id))}</div>
    <div style="overflow:auto; padding:0">
      <table class="u2-table -detail">
        <tr>
          <th> Active:
          <td>
            <input type=hidden name=active value=0>
            <input type=checkbox name=active value=1 ${vs.active ? "checked" : ""}>
        <tr>
          <th> Email:
          <td> <input name=email value="${hee(vs.email ?? "")}">
        <tr>
          <th> Passwort:
          <td> <input name=pw autocomplete=new-password type=password>
        <tr>
          <th> Vorname:
          <td> <input name=firstname value="${hee(vs.firstname ?? "")}">
        <tr>
          <th> Nachname:
          <td> <input name=lastname value="${hee(vs.lastname ?? "")}">
        <tr>
          <th> Firma:
          <td> <input name=company value="${hee(vs.company ?? "")}">
        ${superuserRow}
      </table>
    </div>
  </div>

  <div class=u2-card style="flex:0 1 auto">
    <div class=-head>Gruppen</div>
    <table class="u2-table -set_grp" style="width:auto">
      ${grpHtml}
    </table>
  </div>
</div>`;
}
