import { html, unixTime } from "@qino/qino";
import { factors } from "@qino/qino/auth";
import { backend } from "@qino/qino/cms.backend";

import type { App, Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export const cms = { node: { render } };

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, "cms.backend.superuser.auth", { en: "Authentication", de: "Authentifizierung" });
}

const yesNo = (v?: boolean) => v ? html`<u2-ico icon=check_circle>✓</u2-ico>` : "";

function since(at: number): string {
  const s = unixTime() - at;
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function render(node: Node, { ctx }: { ctx: Ctx }): HtmlString {
  const declared = factors(node.app);
  const via = (ctx.sess.data.core.via() ?? {}) as Record<string, number>;

  const factorRows = declared.map((f) => html`<tr>
    <td>${f.label}
    <td><code>${f.name}</code>
    <td>${yesNo(f.login)}
    <td>${yesNo(f.stepUp)}`);

  const viaRows = Object.entries(via).sort((a, b) => b[1] - a[1]).map(([name, at]) => html`<tr>
    <td><code>${name}</code>
    <td>${since(at)}
    <td>${declared.some((f) => f.name === name) ? "" : "record only"}`);

  return html`<div class=u2-flex>
<div class=u2-card style="flex:1 1 20rem">
  <div class=-head>Declared factors (${declared.length})</div>
  <table class=u2-table>
    <thead><tr>
      <th>Method
      <th>Name
      <th>Login
      <th>Step-up
    <tbody>${factorRows.length ? html.join(factorRows, "\n") : html`<tr><td colspan=4>No module declares a factor.`}</tbody>
  </table>
  <div class=-body>A module declares one by exporting <code>authFactor</code>. Nothing here knows a
  factor by name, so a new one shows up in this table on its own.</div>
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
</div>`;
}
