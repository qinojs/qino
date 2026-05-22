import { getCtx } from "../core/lib/RequestContext.ts";
import type { Node } from "../cms/lib/Node.ts";
import type { App } from "../core/server.ts";
import { renderTables } from "./views/tables.ts";
import { renderDiff } from "./views/diff.ts";
import { renderModules } from "./views/modules.ts";
import { renderConflicts } from "./views/conflicts.ts";

const VIEWS = [
  { key: "tables",    label: "Tables" },
  { key: "diff",      label: "Diff" },
  { key: "modules",   label: "Modules" },
  { key: "conflicts", label: "Conflicts" },
] as const;

type ViewKey = typeof VIEWS[number]["key"];

export async function render(node: Node): Promise<string> {
  const ctx = getCtx();
  const app = node.app;
  if (!await ctx.user?.get?.("superuser")) return "<div></div>";

  const { db } = app;
  const modules = app.modules.all();
  const view = (ctx.get.view ?? "tables") as ViewKey;
  const table = ctx.get.table ?? "";

  const dispatch: Record<ViewKey, () => Promise<string> | string> = {
    tables:    () => renderTables(app, db, modules, table),
    diff:      () => renderDiff(app, db),
    modules:   () => renderModules(app, modules),
    conflicts: () => renderConflicts(app, modules),
  };

  const nav = await Promise.all(VIEWS.map(async ({ key, label }) =>
    `<a class="-nav-item${view === key ? " -active" : ""}" href="?view=${key}">${await app.t`${label}`}</a>`
  )).then(a => a.join(""));

  const content = await (dispatch[view] ?? dispatch.tables)();

  return `<div class="-m-cms-backend-superuser-db">
  <div class=u2-card>
    <div class="-head">DB Manager</div>
    <nav class="-nav">${nav}</nav>
  </div>
  ${content}
</div>`;
}
