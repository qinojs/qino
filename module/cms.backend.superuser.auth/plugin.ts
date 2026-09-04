import { html, isOn, walk } from "@qino/qino";
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
  const declared = factors(node.app).sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
  const via = viaOf(ctx);
  const mine = ctx.userId ? await userFactors(node.app, ctx.userId) : [];
  const twoFactor = isOn(await node.app.settings.core.loginTwoFactor);

  // the columns are the declaration itself, so the table reads like the code
  const factorRows = declared.map((f) => html`<tr>
    <td><code>${f.name}</code>
    <td>${f.label}
    <td>${f.order ?? 50}
    <td>${yesNo(f.second)}
    <td>${yesNo(f.stepUp)}
    <td>${yesNo(mine.some((m) => m.name === f.name))}`);

  // the only form of the demand a listing can see
  const guardedRows = [...walk(node.app.apiTree)]
    .filter((r) => r.verb.requireStepUp)
    .map((r) => ({
      route: r.method.toUpperCase() + " " + r.segments.join("/"),
      description: r.verb.description ?? "",
      maxAge: r.verb.requireStepUp === true ? 300 : (r.verb.requireStepUp as { maxAge: number }).maxAge,
    }))
    .sort((a, b) => a.route.localeCompare(b.route))
    .map((g) => html`<tr>
      <td><code>${g.route}</code>
      <td>${g.description}
      <td>${Math.round(g.maxAge / 60)} min`);

  const viaRows = Object.entries(via).sort((a, b) => b[1] - a[1]).map(([name, at]) => html`<tr>
    <td><code>${name}</code>
    <td>${when(at)}
    <td>${declared.some((f) => f.name === name) ? "" : "record only"}`);

  // Every signed-in session carries its own record, so the same structure read across the table is
  // the log of how everyone got in — no second place to write it.
  const sessions = await node.app.db.query`
    SELECT s.usr_id, s.data, s.access, u.username FROM sess s LEFT JOIN usr u ON u.id = s.usr_id
    WHERE s.usr_id IS NOT NULL ORDER BY s.access DESC LIMIT 50`;
  const sessionRows = sessions.map((s) => {
    const ways = Object.entries(viaOf(String(s.data ?? ""))).sort((a, b) => b[1] - a[1]);
    return html`<tr>
      <td>${s.username ?? `#${s.usr_id}`}
      <td>${ways.length ? html.join(ways.map(([name, at]) => html`<code>${name}</code> ${when(at)}`), ", ") : "—"}
      <td>${when(Number(s.access))}`;
  });

  return html`<div class=u2-flex>
<div class=u2-card style="flex:1 1 20rem">
  <div class=-head>Declared factors (${declared.length})</div>
  <table class=u2-table>
    <thead><tr>
      <th>name
      <th>label
      <th width=40>order
      <th>second
      <th>stepUp
      <th>has(you)
    <tbody>${factorRows.length ? html.join(factorRows, "\n") : html`<tr><td colspan=6>No module declares a factor.`}
  </table>
  <div>The columns are the fields a module exports as <code>authFactors</code>:
  <code>second</code> can only finish a login, <code>stepUp</code> also refreshes an open session,
  <code>order</code> sorts the offer, <code>has()</code> is unanswered where a factor cannot tell.
  <p>Second factor demanded: <strong>${twoFactor ? "yes" : "no"}</strong>
  (<code>core.loginTwoFactor</code>). ${twoFactor
    ? html`An unfinished login waits ten minutes as <code>core.pending</code>; who has no second
      factor is let in with one.`
    : html`One factor that is not a <code>second</code> opens a session.`}</div>
</div>
<div class=u2-card style="flex:1 1 30rem">
  <div class=-head>Verbs that always demand a fresh proof (${guardedRows.length})</div>
  <div style="overflow:auto; padding:0">
    <table class=u2-table>
      <thead><tr>
        <th>route
        <th>description
        <th width=60>maxAge
      <tbody>${guardedRows.length ? html.join(guardedRows, "\n") : html`<tr><td colspan=3>No verb demands one.`}
    </table>
  </div>
  <div>Read out of the api tree: these carry <code>requireStepUp</code>, and
  <code>invoke()</code> asks before running them. They are the ways a factor is handed out or taken
  away. A demand that depends on the call (<code>guard</code>) cannot appear
  here — being listable is what the declared form is for.</div>
</div>
<div class=u2-card style="flex:1 1 20rem">
  <div class=-head>How this session got here</div>
  <table class=u2-table>
    <thead><tr>
      <th>Recorded as
      <th>When
      <th>
    <tbody>${viaRows.length ? html.join(viaRows, "\n") : html`<tr><td colspan=3>Nothing recorded — this session was never authenticated.`}
  </table>
  <div>Every way in is written to <code>sess.data.core.via</code>. A
  <em>record only</em> entry proves nothing and can never satisfy a step-up: <code>remember</code>
  is a login the stored client was handed, <code>login_as</code> one an administrator took over.</div>
</div>
<div class=u2-card style="flex:1 1 100%">
  <div class=-head>Signed-in sessions (${sessions.length})</div>
  <div style="overflow:auto; padding:0">
    <table class=u2-table>
      <thead><tr>
        <th>User
        <th>Came in by
        <th>Last seen
      <tbody>${sessionRows.length ? html.join(sessionRows, "\n") : html`<tr><td colspan=3>Nobody is signed in.`}
    </table>
  </div>
  <div>The same record read across the session table — no separate log to keep, and a
  session that ends takes its own with it.</div>
</div>
</div>`;
}
