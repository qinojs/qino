import type { Node } from "../cms/mod.ts";
import type { App } from "../core/mod.ts";

export const name = "cms.cont.text";
export const needs = ["cms"];

export async function install({app}: { app: App }): Promise<void> {
  const exists = await app.db.one(`SELECT name FROM module WHERE name = 'cms.cont.text'`);
  //if (!exists) await app.db.query(`INSERT INTO module SET access = '1', name = 'cms.cont.text'`);
  if (!exists) await app.db.table('module').insert({ access: '1', name: 'cms.cont.text' });
}

async function render(node: Node) {
  const text = await node.showText("main");
  return `<div${node.edit ? ` contenteditable cmstxt=${text.id}` : ""}>${text}</div>`;
}

export const cms = {
  node: {
    render,
  },
};
