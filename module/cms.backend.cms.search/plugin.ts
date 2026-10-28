import { html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import * as u2 from "@qino/qino/u2";

import manifest from "./manifest.json" with { type: "json" };

import type { App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Searches", de: "Suchanfragen", fr: "Recherches", it: "Ricerche" });
}

export async function uninstall({ app }: { app: App }): Promise<void> {
  await backend.uninstall(app, name);
}

async function render(node: Node) {
  const { db, t } = node.app;
  const [frequent, empty, recent] = await Promise.all([
    db.query`SELECT search, lang, COUNT(*) AS count FROM cms_search GROUP BY search, lang ORDER BY count DESC, search LIMIT 100`,
    db.query`SELECT search, lang, COUNT(*) AS count FROM cms_search WHERE hits = ${0} GROUP BY search, lang ORDER BY count DESC, search LIMIT 100`,
    db.query`SELECT s.*, l.time FROM cms_search s LEFT JOIN log l ON l.id = s.log_id ORDER BY s.log_id DESC, s.id DESC LIMIT 100`,
  ]);
  const summary = (rows: typeof frequent) => html.async`<table class=u2-table>
    <thead><tr>
      <th>${t`Search term`}
      <th>${t`Language`}
      <th>${t`Searches`}
    <tbody>${rows.map((r) => html`<tr>
      <td>${r.search}
      <td>${r.lang}
      <td>${r.count}`)}
  </table>`;

  return html.async`<div class=u2-flex>
    <div class=u2-card>
      <div class=-head>${t`Frequent search terms`}</div>
      ${summary(frequent)}
    </div>
    <div class=u2-card>
      <div class=-head>${t`Searches without results`}</div>
      ${summary(empty)}
    </div>
    <div class=u2-card>
      <div class=-head>${t`Recent searches`}</div>
      <table class=u2-table>
        <thead><tr>
          <th>${t`Time`}
          <th>${t`Search term`}
          <th>${t`Language`}
          <th>${t`Results`}
          <th>${t`Search page`}
        <tbody>${recent.map(async (r) => html.async`<tr>
          <td>${r.time == null ? "–" : u2.el.time(r.time)}
          <td>${r.search}
          <td>${r.lang}
          <td>${r.hits}
          <td>${node.cms.link(await node.cms.node(Number(r.node_id)))}`)}
      </table>
    </div>
  </div>`;
}

export const cms = { node: { render } };
