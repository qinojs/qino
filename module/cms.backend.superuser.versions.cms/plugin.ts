import { hee, type App } from "../core/mod.ts";
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
async function nodeAnchor(node: Node, id: number): Promise<string> {
  const P = await node.app.cms.node(id);
  const own = (await (await P.title())?.string?.() ?? "").trim();
  let label = own || `#${id}`;
  if (P.vs?.type === "c") {
    const pageTitle = (await (await (await P.page()).title())?.string?.() ?? "").trim();
    const inner = own || String(P.vs?.module ?? "") || `#${id}`;
    label = pageTitle ? `${pageTitle} › ${inner}` : inner;
  }
  return `<a href="${hee(await P.url())}" target=_blank>${hee(label)}</a>`;
}

async function render(node: Node): Promise<string> {
  const app = node.app;
  const db = app.db;

  // ── recently edited nodes ──────────────────────────────────────────────────
  // Derived from the history (log.time + editor); vers_cms_page_changed is not
  // reliably updated on text edits, so we read the actual capture rows instead.
  // ROW_NUMBER picks the latest edit per node to carry its editor email.
  const recent = await db.all`
    SELECT x.page_id, x.time AS last, x.email FROM (
      SELECT page_id, time, email, ROW_NUMBER() OVER (PARTITION BY page_id ORDER BY time DESC) rn FROM (
        SELECT pt.page_id AS page_id, l.time AS time, u.email AS email FROM _vers_text vt JOIN log l ON l.id=vt._vers_log JOIN page_text pt ON pt.text_id=vt.id LEFT JOIN sess s ON l.sess_id=s.id LEFT JOIN usr u ON s.usr_id=u.id WHERE vt._vers_log>0
        UNION ALL SELECT p.id, l.time, u.email FROM _vers_text vt JOIN log l ON l.id=vt._vers_log JOIN page p ON p.title_id=vt.id LEFT JOIN sess s ON l.sess_id=s.id LEFT JOIN usr u ON s.usr_id=u.id WHERE vt._vers_log>0
        UNION ALL SELECT vp.id, l.time, u.email FROM _vers_page vp JOIN log l ON l.id=vp._vers_log LEFT JOIN sess s ON l.sess_id=s.id LEFT JOIN usr u ON s.usr_id=u.id WHERE vp._vers_log>0
      ) y
    ) x WHERE x.rn=1 ORDER BY x.time DESC LIMIT 20`.catch(() => []);
  let recentRows = "";
  for (const r of recent) {
    const anchor = await nodeAnchor(node, Number(r.page_id));
    const iso = new Date(Number(r.last) * 1000).toISOString();
    recentRows += `<tr><td>${anchor}<td><u2-time datetime="${iso}" type=relative></u2-time><td>${hee(r.email ?? "guest")}`;
  }
  const recentBox = `
<div class=u2-card>
  <div class=-head>${await app.t`Recently edited`}</div>
  <div class=-body style="padding:0">
    <table class=u2-table style="white-space:nowrap">
      <thead><tr><th>${await app.t`Node`}<th>${await app.t`Edited`}<th>${await app.t`By`}
      <tbody>${recentRows || `<tr><td colspan=3>${await app.t`No history yet`}`}
    </table>
  </div>
</div>`;

  // ── nodes with most text-version churn ─────────────────────────────────────
  const top = await db.all`SELECT page_id, COUNT(*) AS n FROM _vers_page_text WHERE _vers_log > 0 GROUP BY page_id ORDER BY n DESC LIMIT 20`.catch(() => []);
  let topRows = "";
  for (const r of top) {
    topRows += `<tr><td>${await nodeAnchor(node, Number(r.page_id))}<td style="text-align:right">${hee(String(r.n))}`;
  }
  const topBox = `
<div class=u2-card>
  <div class=-head>${await app.t`Nodes with most history`}</div>
  <div class=-body style="padding:0">
    <table class=u2-table style="white-space:nowrap">
      <thead><tr><th>${await app.t`Node`}<th style="text-align:right">${await app.t`Text versions`}
      <tbody>${topRows || `<tr><td colspan=2>${await app.t`No history yet`}`}
    </table>
  </div>
</div>`;

  // ── unpublished changes (draft newer than live) ────────────────────────────
  const changed = await db.all`
    SELECT d.page_id FROM vers_cms_page_changed d
    JOIN vers_cms_page_changed l ON l.page_id = d.page_id AND l.space = 0
    WHERE d.space <> 0 AND d.changed_page > l.changed_page`.catch(() => []);
  let changedRows = "";
  for (const r of changed) {
    changedRows += `<tr><td>${await nodeAnchor(node, Number(r.page_id))}`;
  }
  const changedBox = `
<div class=u2-card style="flex-grow:0">
  <div class=-head>${await app.t`Unpublished changes`}</div>
  <div class=-body style="padding:0">
    <table class=u2-table>
      <tbody>${changedRows || `<tr><td>${await app.t`None`}`}
    </table>
  </div>
</div>`;

  return `<div class=u2-flex>${recentBox}${topBox}${changedBox}</div>`;
}

export const cms = {
  node: {
    render,
  },
};
