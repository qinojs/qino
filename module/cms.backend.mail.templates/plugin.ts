import { backend } from "../cms.backend/mod.ts";
import { mail } from "../mail/mod.ts";
import { getCtx, html, type HtmlString, unixTime, type App } from "../core/mod.ts";
import type { Node } from "../cms/mod.ts";
import dbSchema from "./dbschema.json" with { type: "json" };

export const name = "cms.backend.mail.templates";
export const description = "Manages reusable mail subjects and HTML templates.";
export const needs = ["cms.backend.mail"];
export { dbSchema };

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Mail Templates", de: "Mail-Vorlagen" });
}

export async function init(app: App): Promise<void> {
  const rows = await app.db.query`SELECT name, html FROM mail_template`;
  for (const row of rows) {
    if (row.name && row.html) mail(app).templates[row.name] = row.html;
  }
}

async function render(node: Node): Promise<HtmlString | string> {
  const ctx = getCtx();
  const app = node.app;
  const t = app.t;
  const db = app.db;

  const id = Number(ctx.req.query.id);
  if (id) return renderDetail(node, id);

  let message: HtmlString | string = "";

  const post = ctx.req.body;
  if (post?.csrfToken === ctx.csrfToken && "create" in post) {
    const tname = String(post.tname ?? "").trim();
    if (!tname) {
      message = await html.async`<div class="-msg -err">${t`Name is required.`}</div>`;
    } else {
      const exists = await db.one`SELECT id FROM mail_template WHERE name=${tname}`;
      if (exists) {
        message = await html.async`<div class="-msg -err">${t`A template with this name already exists.`}</div>`;
      } else {
        const now = unixTime();
        const newId = await db.table("mail_template").insert({ name: tname, created: now, updated: now });
        ctx.res.status = 302;
        ctx.res.headers.set("Location", `?id=${newId}`);
        return "";
      }
    }
  }

  const rows = await db.query`SELECT id, name, description, updated FROM mail_template ORDER BY name`;

  const u = ctx.req.url.toURL();
  const trs = rows.length
    ? html.join(rows.map((r) => {
        const d = new Date(typeof r.updated === "number" ? r.updated * 1000 : String(r.updated));
        const iso = Number.isNaN(d.getTime()) ? "" : d.toISOString();
        const time = iso ? html`<u2-time datetime="${iso}" type=relative minute>${iso.slice(0, 16).replace("T", " ")}</u2-time>` : "-";
        u.searchParams.set("id", String(r.id));
        return html`<tr u2-href>
        <td><a href="${u.search}">${r.name}</a>
        <td>${r.description}
        <td>${time}`;
      }))
    : await html.async`<tr><td colspan=3><em>${t`No templates yet.`}</em>`;

  return html.async`<div class=u2-flex>
  <div class=u2-card style="flex:0 1 17.5rem">
    <div class=-head>${t`New template`}</div>
    ${message ? html`<div class=-body>${message}</div>` : ""}
    <form method=post>
      <input type=hidden name=csrfToken value="${ctx.csrfToken}">
      <table class=u2-table>
        <tr>
          <th style="width:5rem">${t`Name`}
          <td><input name=tname required placeholder="e.g. newsletter" style="width:100%">
        <tr>
          <td colspan=2>
            <button name=create>${t`Create`}</button>
      </table>
    </form>
  </div>
  <div class=u2-card style="flex:1">
    <div class=-head>${t`Templates`}</div>
    <div style="overflow:auto; padding:0">
      <table class=u2-table style="white-space:nowrap">
        <thead><tr>
          <th>${t`Name`}
          <th>${t`Description`}
          <th>${t`Updated`}
        <tbody>${trs}
      </table>
    </div>
  </div>
</div>`;
}

async function renderDetail(node: Node, id: number): Promise<HtmlString | string> {
  const ctx = getCtx();
  const app = node.app;
  const t = app.t;
  const db = app.db;

  const row = await db.row`SELECT * FROM mail_template WHERE id=${id}`;
  if (!row) return html.async`<div class=u2-card><div class=-body>${t`Template not found.`}</div></div>`;

  const back = ctx.req.url.toURL(); back.searchParams.delete("id");

  let message: HtmlString | string = "";

  const post = ctx.req.body;
  if (post?.csrfToken === ctx.csrfToken) {
    if ("save" in post) {
      const tname = String(post.tname ?? "").trim();
      if (!tname) {
        message = await html.async`<div class="-msg -err">${t`Name is required.`}</div>`;
      } else {
        await db.table("mail_template").update({
          id,
          name:        tname,
          description: String(post.description ?? "").trim() || null,
          subject:     String(post.subject ?? "").trim() || null,
          html:        String(post.html ?? ""),
          updated:     unixTime(),
        });
        await init(app);
        message = await html.async`<div class="-msg -ok">${t`Saved.`}</div>`;
        Object.assign(row, {
          name:        tname,
          description: String(post.description ?? "").trim(),
          subject:     String(post.subject ?? "").trim(),
          html:        String(post.html ?? ""),
        });
      }
    }

    if ("delete" in post) {
      await db.table("mail_template").delete(id);
      delete mail(app).templates[row.name];
      ctx.res.status = 302;
      ctx.res.headers.set("Location", "?");
      return "";
    }
  }

  const preview = row.html
    ? html`<iframe sandbox srcdoc="${row.html}" class=-preview-frame></iframe>`
    : await html.async`<em>${t`No content yet.`}</em>`;

  return html.async`<div class=u2-flex>
  <div class=u2-card style="flex:1 1 37.5rem">
    <div class=-head>${row.name}</div>
    <div class=-body>
      ${message}
      <form method=post>
        <input type=hidden name=csrfToken value="${ctx.csrfToken}">
        <table class=u2-table>
          <tr>
            <th style="width:6.875rem">${t`Name`}
            <td><input name=tname value="${row.name}" required style="width:100%">
          <tr>
            <th>${t`Description`}
            <td><input name=description value="${row.description}" style="width:100%">
          <tr>
            <th>${t`Default subject`}
            <td><input name=subject value="${row.subject}" style="width:100%" placeholder="${t`optional`}">
          <tr>
            <th>${t`HTML`}
            <td><textarea name=html class=-body-editor>${row.html}</textarea>
          <tr>
            <td colspan=2>
              <div class=-actions>
                <button name=save>${t`Save`}</button>
                <button name=delete type=submit formnovalidate u2-confirm="${t`Really delete this template?`}">${t`Delete`}</button>
                <a href="${back.search}">${t`Back`}</a>
              </div>
        </table>
      </form>
    </div>
  </div>
  <div class=u2-card style="flex:1 1 25rem">
    <div class=-head>${t`Preview`}</div>
    <div class=-body style="padding:0">${preview}</div>
  </div>
</div>`;
}


export function backendDashboardWidget(app: App): Promise<HtmlString> {
  return html.async`<div style="overflow:auto; padding:0">
<table class=u2-table style="white-space:nowrap">
  <tr><td>${app.t`Templates`}:<td>${app.db.one`SELECT count(*) FROM mail_template`}
</table>
</div>`;
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    render,
  },
};
