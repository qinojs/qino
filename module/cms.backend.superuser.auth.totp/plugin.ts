import { html } from "@qino/qino";
import { drop, stored } from "@qino/qino/auth";
import { confirm, enrol, verify } from "@qino/qino/auth.totp";
import { backend } from "@qino/qino/cms.backend";

import manifest from "./manifest.json" with { type: "json" };

import type { App, Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export const cms = { node: { render } };

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Authenticator app", de: "Authenticator-App" });
}

/** What the posted form asked for, and what came of it — the message shown above the cards. */
async function act(ctx: Ctx): Promise<{ note: string; started?: { secret: string; uri: string } }> {
  const body = ctx.req.body;
  if (!body || body.csrfToken !== ctx.csrfToken) return { note: "" };
  try {
    if ("start" in body) return { note: "Scan the code, then confirm with what the app shows.", started: enrol(ctx) };
    if ("confirm" in body) {
      await confirm(ctx, String(body.code ?? ""), String(body.label ?? ""));
      return { note: "Set up. The app can prove it is you from now on." };
    }
    if ("test" in body) {
      return { note: await verify(ctx, String(body.code ?? "")) ? "Correct — a fresh proof is now in your session." : "Correct, but it counted for nothing here." };
    }
    if ("forget" in body) {
      await drop(ctx.app, Number(body.usr_id), "totp", Number(body.forget));
      return { note: "Removed." };
    }
  } catch (e) {
    return { note: e instanceof Error ? e.message : String(e) };
  }
  return { note: "" };
}

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const { note, started } = await act(ctx);
  const mine = ctx.userId ? await stored(ctx.app, ctx.userId, "totp") : [];
  const all = await node.app.db.query`
    SELECT f.id, f.usr_id, f.label, f.created, f.last_used, u.username
    FROM usr_auth_factor f LEFT JOIN usr u ON u.id = f.usr_id
    WHERE f.type = ${"totp"} ORDER BY f.created DESC LIMIT 500`;

  const when = (at: unknown) => at ? html`<u2-time datetime="${new Date(Number(at) * 1000).toISOString()}" type=relative></u2-time>` : "—";

  const rows = all.map((r) => html`<tr>
    <td>${r.username ?? `#${r.usr_id}`}
    <td>${r.label || "—"}
    <td>${when(r.created)}
    <td>${when(r.last_used)}
    <td><form method=post>
      <input type=hidden name=csrfToken value="${ctx.csrfToken}">
      <input type=hidden name=usr_id value="${r.usr_id}">
      <button class=u2-unstyle name=forget value="${r.id}" u2-confirm="Remove this authenticator app?"><u2-ico icon=delete>✕</u2-ico></button>
    </form>`);

  const setup = started
    ? html`<form method=post>
        <input type=hidden name=csrfToken value="${ctx.csrfToken}">
        <u2-qrcode>${started.uri}</u2-qrcode>
        <p>Or type the secret by hand: <code>${started.secret}</code>
        <p><input name=label placeholder="What is this device called?">
        <p><input name=code inputmode=numeric autocomplete=one-time-code placeholder="6-digit code" required>
        <button name=confirm value=1>Confirm</button>
      </form>`
    : html`<form method=post>
        <input type=hidden name=csrfToken value="${ctx.csrfToken}">
        <button name=start value=1>Set up an authenticator app</button>
      </form>`;

  return html`<div class=u2-flex>
${note ? html`<div class=u2-card style="flex:1 1 100%"><div class=-body>${note}</div></div>` : ""}
<div class=u2-card style="flex:1 1 20rem">
  <div class=-head>Yours (${mine.length})</div>
  <div class=-body>${setup}</div>
  <div class=-body>
    <form method=post>
      <input type=hidden name=csrfToken value="${ctx.csrfToken}">
      <input name=code inputmode=numeric placeholder="Try a code" required>
      <button name=test value=1>Check</button>
    </form>
  </div>
</div>
<div class=u2-card style="flex:2 1 30rem">
  <div class=-head>Everyone's authenticator apps (${all.length})</div>
  <div style="overflow:auto; padding:0">
    <table class=u2-table>
      <thead><tr>
        <th>User
        <th>Name
        <th>Set up
        <th>Last used
        <th width=60>
      <tbody>${rows.length ? html.join(rows, "\n") : html`<tr><td colspan=5>Nobody has set one up yet.`}
    </table>
  </div>
</div>
</div>`;
}
