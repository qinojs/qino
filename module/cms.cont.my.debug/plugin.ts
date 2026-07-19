import type { Node } from "../cms/mod.ts";
import { hee, getCtx } from "../core/mod.ts";
import { dump } from "../../deps.ts";

export const name = "cms.cont.my.debug";
export const needs = ["cms"];

function vsTable(vs: Record<string, unknown>, exclude: string[] = []): string {
  return '<table>' +
    Object.entries(vs)
    .filter(([k]) => !exclude.includes(k))
    .map(([k, v]) => `<tr><td>${hee(k)}<td>${hee(v)}`)
    .join("\n") +
    '</table>';
}

async function render(_node: Node): Promise<string> {
  const ctx = getCtx();
  const usr = ctx.user;
  const client = ctx.client;

  const clientVs = client ? await client.values() : {};
  const sessionData = await ctx.sess.data();
  const settingsData = await ctx.settings();

  let usrHtml = `<em>not logged in</em>\n`;
  if (usr) {
    const vs = await usr.values();
    const grps = ((await usr.grps?.() ?? []) as number[]).join(", ") || "–";
    usrHtml = `<h3>User #${hee(usr)}</h3>` + vsTable(vs, ["pw"]) +
      `<h3>Groups: ${hee(grps)}</h3>\n`;
  }

  return `<div style="font-size:11px;font-family:monospace;background:#f5f5f5;color:black; padding:8px;display:inline-block">
  <h3>session</h3>
  ${dump(sessionData)}
  <h3>settings</h3>
  ${dump(settingsData)}
  <h3>client</h3>
  ${vsTable(clientVs)}
  ${usrHtml}
  </div>`;
}

export const cms = {
  node: { render },
};
