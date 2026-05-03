// Port of cms.backend.users/index.php + overview.php + detail.php
// deno-lint-ignore-file no-explicit-any

import { hee, getCtx } from "qg";
import { Auth } from "../core/lib/Auth.ts";
import type { Node } from "../cms/lib/Node.ts";
import { list } from "./parts/list.ts";
import { backend } from "../cms.backend/mod.ts";
import pageApi from "./page_api.ts";

export const name = "cms.backend.users";
export const needs = ["cms.backend"];

// Port of cms.backend.users/install.php
export async function install({ app }: any): Promise<void> {
  const P = await backend.install(app, "cms.backend.users");
  if (P) {
    await P.title("en", "Users");
    await P.title("de", "Benutzer");
  }
}

function render(node: Node): Promise<string> {
  const ctx = getCtx();
  const id = ctx.get.id ? parseInt(ctx.get.id) : 0;

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
        pw: await Auth.pw_hash(String(ctx.post.pw ?? "")),
        firstname: String(ctx.post.firstname ?? ""),
        lastname: String(ctx.post.lastname ?? ""),
      });
    }
  }

  const allowLoginAs = !!(await node.settings.allow_login_as) || !!(await ctx.user?.get("superuser"));
  const loginAsTh = allowLoginAs ? '<th width=20>' : "";

  return `<div class=beBoxCont>
\t<div class=c1-box style="flex:0 1 23rem">
\t\t<div class=-head>Benutzer hinzufügen</div>
\t\t${addMessage}
\t\t<form method=post>
\t\t\t<input hidden name=fake1>
\t\t\t<input hidden name=fake2 type=password>
\t\t\t<input type=hidden name=qgToken value="${hee(ctx.token)}">
\t\t\t<table class=c1-style>
\t\t\t\t<tr>
\t\t\t\t\t<th style="width:6em"> Email:
\t\t\t\t\t<td> <input type=text name=email class=-new-email>
\t\t\t\t<tr>
\t\t\t\t\t<th> Passwort:
\t\t\t\t\t<td> <input type=password name=pw autocomplete=new-password>
\t\t\t\t<tr>
\t\t\t\t\t<th> Vorname:
\t\t\t\t\t<td> <input type=text name=firstname>
\t\t\t\t<tr>
\t\t\t\t\t<th> Nachname:
\t\t\t\t\t<td> <input type=text name=lastname>
\t\t\t\t<tr>
\t\t\t\t\t<th>
\t\t\t\t\t<td> <button name=add>hinzufügen</button>
\t\t\t</table>
\t\t</form>
\t</div>

\t<div class=c1-box style="flex:1">
\t\t<div class=-head> Benutzer suchen </div>
\t\t<div class=-body>
\t\t\t<input type=search placeholder="suchen..." id=usrSearch style="width:300px; max-width:100%">
\t\t</div>
\t\t<div style="overflow:auto">
\t\t\t<table class=c1-style>
\t\t\t\t<thead>
\t\t\t\t\t<tr>
\t\t\t\t\t\t<th> ID
\t\t\t\t\t\t<th> Name
\t\t\t\t\t\t<th> Email
\t\t\t\t\t\t<th> Firma
\t\t\t\t\t\t<th> Active
\t\t\t\t\t\t<th> Sessions
\t\t\t\t\t\t<th> zuletzt online
\t\t\t\t\t\t${loginAsTh}
\t\t\t\t\t\t<th width=20>
\t\t\t\t\t\t<th width=20>
\t\t\t\t<tbody data-part=list>
\t\t\t\t\t${ await list(node, {ctx, vars: {}}) }
\t\t\t</table>
\t\t</div>
\t</div>
</div>`;
}

export const cms = {
  node: {
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

  const vs: any = await db.row("SELECT * FROM usr WHERE id = ?", [id]);
  if (!vs) return '<div class=c1-box><div class=-body>Benutzer nicht gefunden.</div></div>';

  const isSuperuser = !!(await ctx.user?.get("superuser"));
  const superuserRow = isSuperuser ? `
\t\t\t\t<tr>
\t\t\t\t\t<th> Superuser:
\t\t\t\t\t<td>
\t\t\t\t\t\t<input type=hidden name=superuser value=0>
\t\t\t\t\t\t<input type=checkbox name=superuser value=1 ${vs.superuser ? "checked" : ""}>` : "";

  const grpRows = await db.all(
    "SELECT grp.*, usr_grp.usr_id as has FROM grp LEFT JOIN usr_grp ON grp.id = usr_grp.grp_id AND usr_grp.usr_id = ? ORDER BY grp.name",
    [id]
  );

  let grpHtml = "";
  for (const g of grpRows) {
    grpHtml += `
\t\t\t<tr>
\t\t\t\t<td>${hee(g.name)}
\t\t\t\t<td>
\t\t\t\t\t<input type=checkbox value=${hee(g.id)} ${g.has ? "checked" : ""}>`;
  }

  return `<div class=beBoxCont itemid="${hee(String(id))}">
\t<div class=c1-box style="flex:0 1 340px">
\t\t<div class=-head>Benutzer ${hee(String(vs.id))}</div>
\t\t<div style="overflow:auto">
\t\t\t<table class="c1-style -detail">
\t\t\t\t<tr>
\t\t\t\t\t<th> Active:
\t\t\t\t\t<td>
\t\t\t\t\t\t<input type=hidden name=active value=0>
\t\t\t\t\t\t<input type=checkbox name=active value=1 ${vs.active ? "checked" : ""}>
\t\t\t\t<tr>
\t\t\t\t\t<th> Email:
\t\t\t\t\t<td> <input name=email value="${hee(vs.email ?? "")}">
\t\t\t\t<tr>
\t\t\t\t\t<th> Passwort:
\t\t\t\t\t<td> <input name=pw autocomplete=new-password type=password>
\t\t\t\t<tr>
\t\t\t\t\t<th> Vorname:
\t\t\t\t\t<td> <input name=firstname value="${hee(vs.firstname ?? "")}">
\t\t\t\t<tr>
\t\t\t\t\t<th> Nachname:
\t\t\t\t\t<td> <input name=lastname value="${hee(vs.lastname ?? "")}">
\t\t\t\t<tr>
\t\t\t\t\t<th> Firma:
\t\t\t\t\t<td> <input name=company value="${hee(vs.company ?? "")}">
\t\t\t\t${superuserRow}
\t\t\t</table>
\t\t</div>
\t</div>

\t<div class=c1-box style="flex:0 1 auto">
\t\t<div class=-head>Gruppen</div>
\t\t<table class="c1-style -set_grp" style="width:auto">
\t\t\t${grpHtml}
\t\t</table>
\t</div>
</div>`;
}
