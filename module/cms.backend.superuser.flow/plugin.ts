import { html, toJsonSchema } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { history, hosts } from "@qino/qino/sandbox.flow";

import api from "./nodeApi.ts";
import { renderDetail, renderList } from "./render.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, Emitter } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Flows", de: "Abläufe" });
}

const list = async (node: Node) => {
  const rows = await node.app.db.query`
    SELECT flow.*, usr.username AS owner FROM flow LEFT JOIN usr ON usr.id = flow.usr_id ORDER BY flow.id DESC`;
  return renderList(node.app, rows.map((row) => ({ ...row, last: history(node.app, Number(row.id)).runs[0] })));
};

const detail = async (node: Node, { vars = {} }: { vars?: Record<string, unknown> }) => {
  const id = Number(vars.flow) || 0; // none picked yet
  const row = id ? await node.app.db.row`SELECT * FROM flow WHERE id = ${id}` : undefined;
  const all = Object.entries(hosts(node.app))
    .map(([name, host]) => [name, (host.constructor as typeof Emitter).events] as const);
  const decl = row && all.find(([name]) => name === row.host)?.[1][String(row.event)];
  return renderDetail(node.app, row, {
    events: all.flatMap(([name, events]) => Object.keys(events).map((event) => `${name} ${event}`)),
    schema: decl && toJsonSchema(decl.data),
    history: history(node.app, id),
  });
};

async function render(node: Node) {
  const { t } = node.app;
  return html.async`<div class=u2-flex>
    <div class=u2-card style="flex:0 1 50rem">
        <div class=-head>${t`Flows`}</div>
        <table class=u2-table cms-part=list>${list(node)}</table>
    </div>
    <div class=u2-card style="flex:1 1 30rem" cms-part=detail>${detail(node, {})}</div>
</div>`;
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render,
    api,
    parts: { list, detail },
  },
};
