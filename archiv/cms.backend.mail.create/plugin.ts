import { html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { mail, addressOf } from "../mail/mod.ts";

import manifest from "./manifest.json" with { type: "json" };

import type { App, Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Create Mail", de: "Mail erstellen" });
}

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const app = node.app;
  const t = app.t;
  const db = app.db;

  let message: HtmlString | string = "";

  const post = ctx.req.body;
  if (post?.csrfToken === ctx.csrfToken && ("save" in post || "send" in post)) {
    const subject = String(post.subject ?? "").trim();
    const body = String(post.body ?? "").trim();
    const senderMode = String(post.sender_mode ?? "default");
    const sender = senderMode === "custom" ? String(post.sender_custom ?? "").trim() : "";
    const replyTo = String(post.reply_to ?? "").trim();

    const toUsers = [post.to_users ?? []].flat().map(Number).filter(Boolean);
    const toGroups = [post.to_groups ?? []].flat().map(Number).filter(Boolean);
    const toCustom = String(post.to_custom ?? "").trim();

    // parse custom addresses up-front so format errors surface before anything is created
    const custom = (toCustom ? toCustom.split(/[\n,;]+/) : [])
      .map((line) => line.trim()).filter(Boolean)
      .map((line) => ({ line, rec: addressOf(line) }));
    const invalidCustom = custom.filter((c) => !c.rec).map((c) => c.line);

    if (!subject) {
      message = await html.async`<u2-alert open variant=danger>${t`Subject is required.`}</u2-alert>`;
    } else if (invalidCustom.length) {
      message = await html.async`<u2-alert open variant=danger>${t`Invalid email addresses`}: ${invalidCustom.join(", ")}</u2-alert>`;
    } else {
      const msg = await mail(app).create({ subject, html: body, sender: sender || undefined, replyTo: replyTo || undefined });

      const addedEmails = new Set<string>();
      const add = (email: string, name?: string) => {
        const key = email.trim().toLowerCase();
        if (addedEmails.has(key)) return;
        msg.addTo(email, name);
        addedEmails.add(key);
      };

      for (const uid of toUsers) {
        const usr = await db.row`SELECT username, given_name, family_name FROM usr WHERE id=${uid} AND active=${true}`;
        if (usr?.username) add(String(usr.username), `${usr.given_name ?? ""} ${usr.family_name ?? ""}`.trim() || undefined);
      }

      for (const gid of toGroups) {
        const members = await db.query`SELECT u.username, u.given_name, u.family_name FROM usr u INNER JOIN usr_grp ug ON ug.usr_id=u.id WHERE ug.grp_id=${gid} AND u.active=${true}`;
        for (const usr of members) {
          if (usr.username) add(String(usr.username), `${usr.given_name ?? ""} ${usr.family_name ?? ""}`.trim() || undefined);
        }
      }

      for (const { rec } of custom) if (rec) add(rec.address, rec.name);

      await msg.save();
      const savedId = msg.id;

      if ("send" in post) {
        await msg.send();
        message = await html.async`<u2-alert open variant=success style="margin:0">${t`Mail created and sent`} (${addedEmails.size} ${t`recipients`}). <a href="../?id=${savedId}">${t`View`}</a></u2-alert>`;
      } else {
        message = await html.async`<u2-alert open variant=success>${t`Mail saved`} (${addedEmails.size} ${t`recipients`}). <a href="../?id=${savedId}">${t`View`}</a></u2-alert>`;
      }
    }
  }

  const defaults = await mail(app).defaults().catch(() => ({} as Record<string, unknown>));
  const defaultSender = defaults.sender ? (defaults.sendername ? `${defaults.sendername} <${defaults.sender}>` : defaults.sender) : "";

  const users = await db.query`SELECT id, username, given_name, family_name FROM usr WHERE active=${true} ORDER BY family_name, given_name, username`;
  const groups = await db.query`SELECT id, name FROM grp ORDER BY name`;

  const userOptions = users.length
    ? users.map((u) => html`<option value="${u.id}">${[u.given_name, u.family_name].filter(Boolean).join(" ") || u.username} &lt;${u.username}&gt;`)
    : await html.async`<option disabled>${t`No users found`}`;

  const groupOptions = groups.length
    ? groups.map((g) => html`<option value="${g.id}">${g.name}`)
    : await html.async`<option disabled>${t`No groups found`}`;

  return html.async`<div class=u2-card>
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
