import { html } from "@qino/qino";
import { generate, left, spend } from "@qino/qino/auth.backup_codes";
import { backend } from "@qino/qino/cms.backend";

import manifest from "./manifest.json" with { type: "json" };

import type { App, Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export const cms = { node: { render } };

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Backup codes", de: "Backup-Codes" });
}

async function act(ctx: Ctx): Promise<{ note: string; codes?: string[] }> {
  const body = ctx.req.body;
  if (!body || body.csrfToken !== ctx.csrfToken) return { note: "" };
  try {
    if ("generate" in body) return { note: "Write these down now — they are not shown again.", codes: await generate(ctx) };
    if ("spend" in body) {
      return { note: await spend(ctx, String(body.code ?? "")) ? "Spent — a fresh proof is now in your session." : "Spent, but it counted for nothing here." };
    }
  } catch (e) {
    return { note: e instanceof Error ? e.message : String(e) };
  }
  return { note: "" };
}

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const { note, codes } = await act(ctx);
  const remaining = ctx.userId ? await left(ctx.app, ctx.userId) : 0;
  const all = await node.app.db.query`
    SELECT f.usr_id, COUNT(*) AS unspent, MIN(f.created) AS created, u.email
    FROM usr_auth_factor f LEFT JOIN usr u ON u.id = f.usr_id
    WHERE f.type = ${"backup_codes"} GROUP BY f.usr_id, u.email ORDER BY unspent`;

  const rows = all.map((r) => html`<tr>
    <td>${r.email ?? `#${r.usr_id}`}
    <td>${r.unspent}
    <td><u2-time datetime="${new Date(Number(r.created) * 1000).toISOString()}" type=relative></u2-time>`);

  return html`<div class=u2-flex>
${note ? html`<div class=u2-card style="flex:1 1 100%"><div class=-body>${note}</div></div>` : ""}
<div class=u2-card style="flex:1 1 20rem">
  <div class=-head>Yours (${remaining} unspent)</div>
  ${codes ? html`<div class=-body><pre>${codes.join("\n")}</pre></div>` : ""}
  <div class=-body>
    <form method=post>
      <input type=hidden name=csrfToken value="${ctx.csrfToken}">
      <button name=generate value=1 u2-confirm="This replaces any codes you still have. Continue?">Generate a new set</button>
    </form>
  </div>
  <div class=-body>
    <form method=post>
      <input type=hidden name=csrfToken value="${ctx.csrfToken}">
      <input name=code placeholder="Spend one" required>
      <button name=spend value=1>Check</button>
    </form>
  </div>
</div>
<div class=u2-card style="flex:2 1 25rem">
  <div class=-head>Who has codes left</div>
  <table class=u2-table>
    <thead><tr>
      <th>User
      <th>Unspent
      <th>Generated
    <tbody>${rows.length ? html.join(rows, "\n") : html`<tr><td colspan=3>Nobody has generated any yet.`}
  </table>
  <div class=-body>A code is deleted the moment it is spent, so this count is what is really left.
  Backup codes declare no <code>login</code>: they stand in for a second factor, never for the first.</div>
</div>
</div>`;
}
