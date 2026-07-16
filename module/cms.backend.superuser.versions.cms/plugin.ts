import { html, type HtmlString, type App } from "../core/mod.ts";
import type { Node } from "../cms/mod.ts";
import { backend } from "../cms.backend/mod.ts";

export const name = "cms.backend.superuser.versions.cms";
export const needs = ["cms.backend.superuser.versions", "cms"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "CMS history", de: "CMS-Verlauf" });
}

// Linked label for a node. Contents (type 'c') often have no title, so prefix
// the containing page's title for context: "Page title › content label".
// node.url() points contents at their page + anchor (and edit-links in editmode).
async function nodeAnchor(node: Node, id: number): Promise<HtmlString> {
  const P = await node.cms.node(id);
  const own = (await (await P.title())?.string?.() ?? "").trim();
  let label = own || `#${id}`;
  if (P.vs?.type === "c") {
    const pageTitle = (await (await (await P.page()).title())?.string?.() ?? "").trim();
    const inner = own || String(P.vs?.module ?? "") || `#${id}`;
    label = pageTitle ? `${pageTitle} › ${inner}` : inner;
  }
  return html`<a href="${await P.url()}" target=_blank>${label}</a>`;
}

async function render(node: Node): Promise<HtmlString> {
  const app = node.app;
  const db = app.db;

  // ── recently edited nodes ──────────────────────────────────────────────────
  // Derived from the history (log.time + editor); vers_cms_page_changed is not
  // reliably updated on text edits, so we read the actual capture rows instead.
  // ROW_NUMBER picks the latest edit per node to carry its editor email.
  const recent = await db.query`
    SELECT x.page_id, x.time AS last, x.email FROM (
      SELECT page_id, time, email, ROW_NUMBER() OVER (PARTITION BY page_id ORDER BY time DESC) rn FROM (
        SELECT pt.page_id AS page_id, l.time AS time, u.email AS email FROM _vers_text vt JOIN log l ON l.id=vt._vers_log JOIN page_text pt ON pt.text_id=vt.id LEFT JOIN sess s ON l.sess_id=s.id LEFT JOIN usr u ON s.usr_id=u.id WHERE vt._vers_log>0
        UNION ALL SELECT p.id, l.time, u.email FROM _vers_text vt JOIN log l ON l.id=vt._vers_log JOIN page p ON p.title_id=vt.id LEFT JOIN sess s ON l.sess_id=s.id LEFT JOIN usr u ON s.usr_id=u.id WHERE vt._vers_log>0
        UNION ALL SELECT vp.id, l.time, u.email FROM _vers_page vp JOIN log l ON l.id=vp._vers_log LEFT JOIN sess s ON l.sess_id=s.id LEFT JOIN usr u ON s.usr_id=u.id WHERE vp._vers_log>0
      ) y
    ) x WHERE x.rn=1 ORDER BY x.time DESC LIMIT 20`.catch(() => []);
  const recentParts: HtmlString[] = [];
  for (const r of recent) {
    const anchor = await nodeAnchor(node, Number(r.page_id));
    const iso = new Date(Number(r.last) * 1000).toISOString();
    recentParts.push(html`<tr><td>${anchor}<td><u2-time datetime="${iso}" type=relative></u2-time><td>${r.email ?? "guest"}`);
  }
  const recentBox = html.async`
<div class=u2-card>
  <div class=-head>${app.t`Recently edited`}</div>
  <div class=-body style="padding:0">
    <table class=u2-table style="white-space:nowrap">
      <thead><tr><th>${app.t`Node`}<th>${app.t`Edited`}<th>${app.t`By`}
      <tbody>${recentParts.length ? html.join(recentParts) : html.async`<tr><td colspan=3>${app.t`No history yet`}`}
    </table>
  </div>
</div>`;

  // ── nodes with most text-version churn ─────────────────────────────────────
  const top = await db.query`SELECT page_id, COUNT(*) AS n FROM _vers_page_text WHERE _vers_log > 0 GROUP BY page_id ORDER BY n DESC LIMIT 20`.catch(() => []);
  const topParts: HtmlString[] = [];
  for (const r of top) {
    topParts.push(html`<tr><td>${await nodeAnchor(node, Number(r.page_id))}<td style="text-align:right">${r.n}`);
  }
  const topBox = html.async`
<div class=u2-card>
  <div class=-head>${app.t`Nodes with most history`}</div>
  <div class=-body style="padding:0">
    <table class=u2-table style="white-space:nowrap">
      <thead><tr><th>${app.t`Node`}<th style="text-align:right">${app.t`Text versions`}
      <tbody>${topParts.length ? html.join(topParts) : html.async`<tr><td colspan=2>${app.t`No history yet`}`}
    </table>
  </div>
</div>`;

  // ── unpublished changes (draft newer than live) ────────────────────────────
  const changed = await db.query`
    SELECT d.page_id FROM vers_cms_page_changed d
    JOIN vers_cms_page_changed l ON l.page_id = d.page_id AND l.space = 0
    WHERE d.space <> 0 AND d.changed_page > l.changed_page`.catch(() => []);
  const changedParts: HtmlString[] = [];
  for (const r of changed) {
    changedParts.push(html`<tr><td>${await nodeAnchor(node, Number(r.page_id))}`);
  }
  const changedBox = html.async`
<div class=u2-card style="flex-grow:0">
  <div class=-head>${app.t`Unpublished changes`}</div>
  <div class=-body style="padding:0">
    <table class=u2-table>
      <tbody>${changedParts.length ? html.join(changedParts) : html.async`<tr><td>${app.t`None`}`}
    </table>
  </div>
</div>`;

  return html.async`<div class=u2-flex>${recentBox}${topBox}${changedBox}</div>`;
}

export const cms = {
  node: {
    render,
  },
};
