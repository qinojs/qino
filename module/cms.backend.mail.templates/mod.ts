import { backend } from "../cms.backend/mod.ts";
import type {} from "../mail/mod.ts";
import { getCtx } from "../core/lib/RequestContext.ts";
import { hee } from "../core/lib/util.ts";
import type { Node } from "../cms/lib/Node.ts";
import type { App } from "../core/server.ts";
import dbSchema from "./dbschema.json" with { type: "json" };

export const name = "cms.backend.mail.templates";
export const needs = ["cms.backend.mail"];
export { dbSchema };

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Mail Templates", de: "Mail-Vorlagen" });
}

export async function init(app: App): Promise<void> {
  const rows = await app.db.all("SELECT name, html FROM mail_template");
  for (const row of rows) {
    if (row.name && row.html) app.mail.templates[row.name] = row.html;
  }
}

async function render(node: Node): Promise<string> {
  const ctx = getCtx();
  const app = node.app;
  const db = app.db;

  const id = Number(ctx.get.id ?? 0);
  if (id) return renderDetail(node, id);

  let message = "";

  if (ctx.post.qgToken === ctx.token && "create" in ctx.post) {
    const tname = String(ctx.post.tname ?? "").trim();
    if (!tname) {
      message = `<div class="-msg -err">${await app.t`Name is required.`}</div>`;
    } else {
      const exists = await db.one("SELECT id FROM mail_template WHERE name=?", [tname]);
      if (exists) {
        message = `<div class="-msg -err">${await app.t`A template with this name already exists.`}</div>`;
      } else {
        const now = Math.floor(Date.now() / 1000);
        const newId = await db.table("mail_template").insert({ name: tname, created: now, updated: now });
        ctx.responseStatus = 302;
        ctx.responseHeaders.set("Location", `?id=${newId}`);
        return "";
      }
    }
  }

  const rows = await db.all("SELECT id, name, description, updated FROM mail_template ORDER BY name");

  const trs = rows.length
    ? rows.map((r: any) => {
        const d = new Date(typeof r.updated === "number" ? r.updated * 1000 : String(r.updated));
        const iso = isNaN(d.getTime()) ? "" : d.toISOString();
        const time = iso ? `<u2-time datetime="${iso}" type=relative minute>${iso.slice(0, 16).replace("T", " ")}</u2-time>` : "-";
        return `<tr u2-href>
        <td><a href="?id=${hee(r.id)}">${hee(r.name)}</a>
        <td>${hee(r.description ?? "")}
        <td>${time}`;
      }).join("")
    : `<tr><td colspan=3><em>${await app.t`No templates yet.`}</em>`;

  return `<div class="u2-flex -m-mail-templates">
  <div class=u2-card style="flex:0 1 280px">
    <div class=-head>${await app.t`New template`}</div>
    ${message ? `<div class=-body>${message}</div>` : ""}
    <form method=post>
      <input type=hidden name=qgToken value="${hee(ctx.token)}">
      <table class=u2-table>
        <tr>
          <th style="width:80px">${await app.t`Name`}
          <td><input name=tname required placeholder="e.g. newsletter" style="width:100%">
        <tr>
          <td colspan=2>
            <button name=create>${await app.t`Create`}</button>
      </table>
    </form>
  </div>
  <div class=u2-card style="flex:1">
    <div class=-head>${await app.t`Templates`}</div>
    <div style="overflow:auto; padding:0">
      <table class=u2-table style="white-space:nowrap">
        <thead><tr>
          <th>${await app.t`Name`}
          <th>${await app.t`Description`}
          <th>${await app.t`Updated`}
        <tbody>${trs}
      </table>
    </div>
  </div>
</div>`;
}

async function renderDetail(node: Node, id: number): Promise<string> {
  const ctx = getCtx();
  const app = node.app;
  const db = app.db;

  const row = await db.row("SELECT * FROM mail_template WHERE id=?", [id]);
  if (!row) return `<div class=u2-card><div class=-body>${await app.t`Template not found.`}</div></div>`;

  let message = "";

  if (ctx.post.qgToken === ctx.token) {
    if ("save" in ctx.post) {
      const tname = String(ctx.post.tname ?? "").trim();
      if (!tname) {
        message = `<div class="-msg -err">${await app.t`Name is required.`}</div>`;
      } else {
        await db.table("mail_template").update({
          id,
          name:        tname,
          description: String(ctx.post.description ?? "").trim() || null,
          subject:     String(ctx.post.subject ?? "").trim() || null,
          html:        String(ctx.post.html ?? ""),
          updated:     Math.floor(Date.now() / 1000),
        });
        await init(app);
        message = `<div class="-msg -ok">${await app.t`Saved.`}</div>`;
        Object.assign(row, {
          name:        tname,
          description: String(ctx.post.description ?? "").trim(),
          subject:     String(ctx.post.subject ?? "").trim(),
          html:        String(ctx.post.html ?? ""),
        });
      }
    }

    if ("delete" in ctx.post) {
      await db.query("DELETE FROM mail_template WHERE id=?", [id]);
      delete app.mail.templates[row.name];
      ctx.responseStatus = 302;
      ctx.responseHeaders.set("Location", "?");
      return "";
    }
  }

  const preview = row.html
    ? `<iframe sandbox srcdoc="${hee(row.html)}" class=-preview-frame></iframe>`
    : `<em>${await app.t`No content yet.`}</em>`;

  return `<div class="u2-flex -m-mail-templates">
  <div class=u2-card style="flex:1 1 600px">
    <div class=-head>${hee(row.name)}</div>
    <div class=-body>
      ${message}
      <form method=post>
        <input type=hidden name=qgToken value="${hee(ctx.token)}">
        <table class=u2-table>
          <tr>
            <th style="width:110px">${await app.t`Name`}
            <td><input name=tname value="${hee(row.name)}" required style="width:100%">
          <tr>
            <th>${await app.t`Description`}
            <td><input name=description value="${hee(row.description ?? "")}" style="width:100%">
          <tr>
            <th>${await app.t`Default subject`}
            <td><input name=subject value="${hee(row.subject ?? "")}" style="width:100%" placeholder="${await app.t`optional`}">
          <tr>
            <th>${await app.t`HTML`}
            <td><textarea name=html class=-body-editor>${hee(row.html ?? "")}</textarea>
          <tr>
            <td colspan=2>
              <div class=-actions>
                <button name=save>${await app.t`Save`}</button>
                <button name=delete type=submit formnovalidate
                  onclick="return confirm('${await app.t`Really delete this template?`}')"
                >${await app.t`Delete`}</button>
                <a href="?">${await app.t`Back`}</a>
              </div>
        </table>
      </form>
    </div>
  </div>
  <div class=u2-card style="flex:1 1 400px">
    <div class=-head>${await app.t`Preview`}</div>
    <div class=-body style="padding:0">${preview}</div>
  </div>
</div>`;
}


export async function backendDashboardWidget(app: App): Promise<string> {
  const total = Number(await app.db.one("SELECT count(*) FROM mail_template"));
  return `<div style="overflow:auto; padding:0">
<table class=u2-table style="white-space:nowrap">
  <tr><td>${await app.t`Templates`}:<td>${hee(String(total))}
</table>
</div>`;
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    render,
  },
};
