import { html } from "@qino/qino";
import { factors, userFactors, via as viaOf } from "@qino/qino/auth";
import { backend } from "@qino/qino/cms.backend";

import manifest from "./manifest.json" with { type: "json" };

import type { App, Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export const cms = { node: { render } };

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Authentication", de: "Authentifizierung" });
}

const yesNo = (v?: boolean) => v ? html`<u2-ico icon=check_circle>✓</u2-ico>` : "";
const when = (at: number) => html`<u2-time datetime="${new Date(at * 1000).toISOString()}" second type=relative></u2-time>`;

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const declared = factors(node.app);
  const via = viaOf(ctx);
  const mine = ctx.userId ? await userFactors(node.app, ctx.userId) : [];

  const factorRows = declared.map((f) => html`<tr>
    <td>${f.label}
    <td><code>${f.name}</code>
    <td>${yesNo(f.login)}
    <td>${yesNo(f.stepUp)}
    <td>${yesNo(mine.some((m) => m.name === f.name))}`);

  const viaRows = Object.entries(via).sort((a, b) => b[1] - a[1]).map(([name, at]) => html`<tr>
    <td><code>${name}</code>
    <td>${when(at)}
    <td>${declared.some((f) => f.name === name) ? "" : "record only"}`);

  // Every signed-in session carries its own record, so the same structure read across the table is
  // the log of how everyone got in — no second place to write it.
  const sessions = await node.app.db.query`
    SELECT s.usr_id, s.data, s.access, u.email FROM sess s LEFT JOIN usr u ON u.id = s.usr_id
    WHERE s.usr_id IS NOT NULL ORDER BY s.access DESC LIMIT 50`;
  const sessionRows = sessions.map((s) => {
    const ways = Object.entries(viaOf(String(s.data ?? ""))).sort((a, b) => b[1] - a[1]);
    return html`<tr>
      <td>${s.email ?? `#${s.usr_id}`}
      <td>${ways.length ? html.join(ways.map(([name, at]) => html`<code>${name}</code> ${when(at)}`), ", ") : "—"}
      <td>${when(Number(s.access))}`;
  });

  return html`<div class=u2-flex>
<div class=u2-card style="flex:1 1 20rem">
  <div class=-head>Declared factors (${declared.length})</div>
  <table class=u2-table>
    <thead><tr>
      <th>Method
      <th>Name
      <th>Login
      <th>Step-up
      <th>You have it
    <tbody>${factorRows.length ? html.join(factorRows, "\n") : html`<tr><td colspan=5>No module declares a factor.`}</tbody>
  </table>
  <div class=-body>A module declares one by exporting <code>authFactor</code>. Nothing here knows a
  factor by name, so a new one shows up in this table on its own. The last column is what the factor
  answers about you — one that cannot tell users apart, as a federated login cannot, leaves it
  unanswered and counts as available.</div>
</div>
<div class=u2-card style="flex:1 1 20rem">
  <div class=-head>How this session got here</div>
  <table class=u2-table>
    <thead><tr>
      <th>Recorded as
      <th>When
      <th>
    <tbody>${viaRows.length ? html.join(viaRows, "\n") : html`<tr><td colspan=3>Nothing recorded — this session was never authenticated.`}</tbody>
  </table>
  <div class=-body>Every way in is written to <code>sess.data.core.via</code>. Entries marked
  <em>record only</em> are no proof: <code>remember</code> is a login the stored client was handed,
  <code>login_as</code> one an administrator took over. Only a declared factor can ever satisfy a
  step-up, so those two are auditable without being worth anything.</div>
</div>
<div class=u2-card style="flex:1 1 100%">
  <div class=-head>Signed-in sessions (${sessions.length})</div>
  <div style="overflow:auto; padding:0">
    <table class=u2-table>
      <thead><tr>
        <th>User
        <th>Came in by
        <th>Last seen
      <tbody>${sessionRows.length ? html.join(sessionRows, "\n") : html`<tr><td colspan=3>Nobody is signed in.`}</tbody>
    </table>
  </div>
  <div class=-body>The same record, read across the session table: who is signed in and what showed
  it. There is no separate log to keep — a session that ends takes its record with it.</div>
</div>
</div>`;
}
