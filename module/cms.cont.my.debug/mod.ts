// deno-lint-ignore-file no-explicit-any
import type { Node } from "../cms/lib/Node.ts";
import { getCtx, hee } from "qg";
import { dump } from "dump.js";

export const name = "cms.cont.my.debug";
export const needs = ["cms"];

function vsTable(vs: Record<string, unknown>, exclude: string[] = []): string {
    return '<table>' +
        Object.entries(vs)
        .filter(([k]) => !exclude.includes(k))
        .map(([k, v]) => `<tr><td>${hee(k)}</td><td>${hee(String(v ?? ""))}</td></tr>`)
        .join("\n") +
        '</table>';
}

async function render(_node: Node): Promise<string> {
    const ctx = getCtx() as any;
    const usr = ctx.user;
    const client = ctx.client;

    const clientVs = client ? await client.getVs() : {};
    const sessionData = await ctx.session();
    const settingsData = await ctx.settings();

    let usrHtml = `<em>nicht eingeloggt</em>\n`;
    if (usr) {
        const vs = await usr.getVs();
        const grps = ((await usr.grps?.() ?? []) as number[]).join(", ") || "–";
        usrHtml = `<h3>User #${hee(String(usr))}</h3>` + vsTable(vs, ["pw"]) +
            `<h3>Gruppen: ${hee(grps)}</h3>\n`;
    }

    return `<div style="font-size:11px;font-family:monospace;background:#f5f5f5;padding:8px;display:inline-block">
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
