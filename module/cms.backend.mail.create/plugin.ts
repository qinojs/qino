import { backend } from "../cms.backend/mod.ts";
import { getCtx, html, type HtmlString, type App } from "../core/mod.ts";
import type { Node } from "../cms/mod.ts";
import type {} from "../mail/mod.ts";

export const name = "cms.backend.mail.create";
export const needs = ["cms.backend.mail"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Create Mail", de: "Mail erstellen" });
}

async function render(node: Node): Promise<HtmlString> {
  const ctx = getCtx();
  const app = node.app;
  const t = app.t;
  const db = app.db;

  let message: HtmlString | string = "";

  if (ctx.req.body?.csrfToken === ctx.csrfToken && ("save" in ctx.req.body || "send" in ctx.req.body)) {
    const subject = String(ctx.req.body.subject ?? "").trim();
    const body = String(ctx.req.body.body ?? "").trim();
    const senderMode = String(ctx.req.body.sender_mode ?? "default");
    const sender = senderMode === "custom" ? String(ctx.req.body.sender_custom ?? "").trim() : "";
    const replyTo = String(ctx.req.body.reply_to ?? "").trim();

    const toUsers = [ctx.req.body.to_users ?? []].flat().map(Number).filter(Boolean);
    const toGroups = [ctx.req.body.to_groups ?? []].flat().map(Number).filter(Boolean);
    const toCustom = String(ctx.req.body.to_custom ?? "").trim();

    if (!subject) {
      message = await html.async`<u2-alert open variant=danger>${t`Subject is required.`}</u2-alert>`;
    } else {
      const mail = await app.mail.create({ subject, html: body, sender: sender || undefined, replyTo: replyTo || undefined });

      const addedEmails = new Set<string>();

      for (const uid of toUsers) {
        const usr = await db.row`SELECT email, firstname, lastname FROM usr WHERE id=${uid} AND active=1`;
        if (usr?.email && !addedEmails.has(usr.email)) {
          mail.addTo(usr.email, `${usr.firstname ?? ""} ${usr.lastname ?? ""}`.trim() || undefined);
          addedEmails.add(usr.email);
        }
      }

      for (const gid of toGroups) {
        const members = await db.query`SELECT u.email, u.firstname, u.lastname FROM usr u INNER JOIN usr_grp ug ON ug.usr_id=u.id WHERE ug.grp_id=${gid} AND u.active=1`;
        for (const usr of members) {
          if (usr.email && !addedEmails.has(usr.email)) {
            mail.addTo(usr.email, `${usr.firstname ?? ""} ${usr.lastname ?? ""}`.trim() || undefined);
            addedEmails.add(usr.email);
          }
        }
      }

      if (toCustom) {
        for (const raw of toCustom.split(/[\n,;]+/)) {
          const addr = raw.trim();
          if (addr && !addedEmails.has(addr)) {
            mail.addTo(addr);
            addedEmails.add(addr);
          }
        }
      }

      await mail.save();
      const savedId = mail.id;

      if ("send" in ctx.req.body) {
        await mail.send();
        message = await html.async`<u2-alert open variant=success style="margin:0">${t`Mail created and sent`} (${addedEmails.size} ${t`recipients`}). <a href="../?id=${savedId}">${t`View`}</a></u2-alert>`;
      } else {
        message = await html.async`<u2-alert open variant=success>${t`Mail saved`} (${addedEmails.size} ${t`recipients`}). <a href="../?id=${savedId}">${t`View`}</a></u2-alert>`;
      }
    }
  }

  const defaults = await app.mail.defaults().catch(() => ({} as Record<string, unknown>));
  const defaultSender = defaults.sender ? (defaults.sendername ? `${defaults.sendername} <${defaults.sender}>` : defaults.sender) : "";

  const users = await db.query`SELECT id, email, firstname, lastname FROM usr WHERE active=1 ORDER BY lastname, firstname, email`;
  const groups = await db.query`SELECT id, name FROM grp ORDER BY name`;

  const userOptions = users.length
    ? html.join(users.map((u) => html`<option value="${u.id}">${[u.firstname, u.lastname].filter(Boolean).join(" ") || u.email} &lt;${u.email}&gt;`))
    : await html.async`<option disabled>${t`No users found`}`;

  const groupOptions = groups.length
    ? html.join(groups.map((g) => html`<option value="${g.id}">${g.name}`))
    : await html.async`<option disabled>${t`No groups found`}`;

  return html.async`<div class="u2-card">
  <div class=-head>${t`Create Mail`}</div>
  <div class=-body>
    ${message}
    <form method=post>
      <input type=hidden name=csrfToken value="${ctx.csrfToken}">
      <table class=u2-table>
        <tr>
          <th style="width:6.875rem">${t`Subject`}
          <td><input name=subject style="width:100%" placeholder="${t`Mail subject`}" required>
        <tr>
          <th>${t`Sender`}
          <td>
            <label><input type=radio name=sender_mode value=default checked> ${t`Default`} <small>(${defaultSender || t`not configured`})</small></label>
            &nbsp;
            <label><input type=radio name=sender_mode value=custom> ${t`Custom`}</label>
            <input name=sender_custom type=email hidden style="margin-top:.25rem;width:100%" placeholder="name@example.com">
        <tr>
          <th>${t`Reply-To`}
          <td><input name=reply_to style="width:100%">
        <tr>
          <th>${t`Recipients`}
          <td>
            <div class=u2-grid style="--u2-Items-width: 25rem;">
              <label>
                <strong>${t`Users`}</strong>
                <select name=to_users multiple size=8 style="width:100%">
                  ${userOptions}
                </select>
              </label>
              <label>
                <strong>${t`Groups`}</strong>
                <select name=to_groups multiple size=8 style="width:100%">
                  ${groupOptions}
                </select>
              </label>
              <label>
                <strong>${t`Custom addresses`}</strong>
                <textarea name=to_custom rows=6 style="width:100%;resize:vertical" placeholder="${t`One per line, or comma-separated`}"></textarea>
              </label>
            </div>
        <tr>
          <th>${t`Body (HTML)`}
          <td>
            <textarea name=body class=-body-editor rows=12 placeholder="<p>${t`Your message here`}</p>"></textarea>
        <tr>
          <td colspan=2>
            <div class=u2-flex style="justify-content:flex-end">
              <button name=save>${t`Save draft`}</button>
              <button name=send>${html.raw(await t`Save &amp; send now`)}</button>
            </div>
      </table>
    </form>
  </div>
</div>`;
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    js: ["pub/main.js"],
    render,
  },
};
