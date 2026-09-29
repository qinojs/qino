import { errMsg, html } from "@qino/qino";
import * as u2 from "@qino/qino/u2";
import { backend } from "@qino/qino/cms.backend";
import { personal } from "@qino/qino/ai1.user_memory";

import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;
const { uniqueColor, ageColor } = backend;
const LIMIT = 200;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "User memories", de: "Benutzer-Memories" });
}

/** What agents keep about users, the newest first. */
export async function list(node: Node): Promise<HtmlString> {
  const { db, t } = node.app;
  const rows = await db.query`SELECT m.id, m.content, m.time, u.username FROM ai1_user_memory m LEFT JOIN usr u ON u.id = m.usr_id ORDER BY m.id DESC LIMIT ${LIMIT}`;
  return html.async`
    <thead><tr>
      <th>${t`User`}
      <th>${t`Memory`}
      <th>${t`When`}
      <th>
    <tbody>${rows.length ? rows.map((m) => html`<tr>
      <td style="color:${uniqueColor(m.username)}">${m.username}
      <td>[u${m.id}] ${m.content}
      <td style="color:${ageColor(m.time)}; white-space:nowrap">${u2.el.time(m.time, { narrow: true })}
      <td><button type=button class=u2-unstyle data-remove="${m.id}" title=remove><u2-ico icon=delete>✕</u2-ico></button>`) : html.async`<tr><td colspan=4>${t`No memories yet`}`}</tbody>`;
}

async function render(node: Node): Promise<HtmlString> {
  const t = node.app.t;
  return html.async`<div class=u2-flex>
    <div class=u2-card><div class=-head>${t`User memories`}</div><table class=u2-table cms-part=list>${list(node)}</table></div>
    <div class=u2-card>
      <div class=-head>${t`Try decide`}</div>
      <form class=u2-flex data-try>
        <input name=content required placeholder="${t`A memory, e.g. always answer in German`}">
        <button>${t`Decide`}</button>
      </form>
      <output></output>
    </div>
  </div>`;
}

/** Remove a memory; or how decide() sorts `decide`. */
async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  try {
    if (vars.remove) return (await node.app.db.table("ai1_user_memory").delete(Number(vars.remove)), { ok: true });
    if (vars.decide) return { ok: true, result: await personal(node.app, String(vars.decide)) };
    return null;
  } catch (e) { return { ok: false, message: errMsg(e) }; }
}

export const cms = { node: { js: ["pub/main.js"], render, api, parts: { list } } };
