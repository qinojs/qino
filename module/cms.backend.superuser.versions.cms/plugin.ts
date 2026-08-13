import { html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";

import manifest from "./manifest.json" with { type: "json" };

import type { HtmlString, App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "CMS history", de: "CMS-Verlauf" });
}

// Linked label for a node. Contents (type 'c') often have no title, so prefix
// the containing page's title for context: "Page title › content label".
// node.url() points contents at their page + anchor (and edit-links in editmode).
async function nodeAnchor(node: Node, id: number): Promise<HtmlString> {
  const page = await node.cms.node(id);
  const own = (await (await page.title()).string() ?? "").trim();
  let label = own || `#${id}`;
  if (page.vs?.type === "c") {
    const pageTitle = (await (await (await page.page()).title()).string() ?? "").trim();
    const inner = own || String(page.vs?.module ?? "") || `#${id}`;
    label = pageTitle ? `${pageTitle} › ${inner}` : inner;
  }
  return html`<a href="${await page.url()}" target=_blank>${label}</a>`;
}

async function render(node: Node): Promise<HtmlString> {
  const app = node.app;
  const db = app.db;

  // ── recently edited nodes ──────────────────────────────────────────────────
  // Derived from node_changed (one row per mutation) joined to log for time+editor.
  // ROW_NUMBER picks the latest edit per node to carry its editor email.
  const recent = await db.query`
    SELECT x.page_id, x.time AS last, x.email FROM (
      SELECT nc.page_id, l.time, u.email, ROW_NUMBER() OVER (PARTITION BY nc.page_id ORDER BY l.time DESC) rn
      FROM node_changed nc
      JOIN log l ON l.id = nc.log_id
      LEFT JOIN sess s ON l.sess_id = s.id
      LEFT JOIN usr u ON s.usr_id = u.id
    ) x WHERE x.rn = 1 ORDER BY x.time DESC LIMIT 20`.catch(() => []);
  const recentParts = [];
  for (const r of recent) {
    const anchor = await nodeAnchor(node, Number(r.page_id));
    const iso = new Date(Number(r.last) * 1000).toISOString();
    recentParts.push(html`<tr>
      <td>${anchor}
      <td><u2-time datetime="${iso}" type=relative></u2-time>
      <td>${r.email ?? "guest"}`);
  }
  const recentBox = html.async`
<div class=u2-card>
  <div class=-head>${app.t`Recently edited`}</div>
  <div style="padding:0">
    <table class=u2-table style="white-space:nowrap">
      <thead><tr>
        <th>${app.t`Node`}
        <th>${app.t`Edited`}
        <th>${app.t`By`}
      <tbody>${recentParts.length ? recentParts : html.async`<tr><td colspan=3>${app.t`No history yet`}`}
    </table>
  </div>
</div>`;

  // ── nodes with most change churn ───────────────────────────────────────────
  const top = await db.query`SELECT page_id, COUNT(*) AS n FROM node_changed GROUP BY page_id ORDER BY n DESC LIMIT 20`.catch(() => []);
  const topParts = [];
  for (const r of top) {
    topParts.push(html`<tr><td>${await nodeAnchor(node, Number(r.page_id))}<td style="text-align:right">${r.n}`);
  }
  const topBox = html.async`
<div class=u2-card>
  <div class=-head>${app.t`Nodes with most history`}</div>
  <div style="padding:0">
    <table class=u2-table style="white-space:nowrap">
      <thead><tr><th>${app.t`Node`}<th style="text-align:right">${app.t`Changes`}
      <tbody>${topParts.length ? topParts : html.async`<tr><td colspan=2>${app.t`No history yet`}`}
    </table>
  </div>
</div>`;

  return html.async`<div class=u2-flex>${recentBox}${topBox}</div>`;
}

export const cms = {
  node: {
    render,
  },
};
