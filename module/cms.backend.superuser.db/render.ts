import { getCtx } from "../core/lib/RequestContext.ts";
import type { Node } from "../cms/lib/Node.ts";
import { renderTables } from "./views/tables.ts";
import { renderDiff } from "./views/diff.ts";
import { renderModules } from "./views/modules.ts";
import { renderConflicts } from "./views/conflicts.ts";

const VIEWS = [
  { key: "tables",    label: "Tabellen" },
  { key: "diff",      label: "Diff" },
  { key: "modules",   label: "Module" },
  { key: "conflicts", label: "Konflikte" },
] as const;

type ViewKey = typeof VIEWS[number]["key"];

export async function render(node: Node): Promise<string> {
  const ctx = getCtx();
  if (!await ctx.user?.get?.("superuser")) return "<div></div>";

  const { db } = node.app;
  const modules = node.app.modules.all();
  const view = (ctx.get.view ?? "tables") as ViewKey;
  const table = ctx.get.table ?? "";

  const dispatch: Record<ViewKey, () => Promise<string> | string> = {
    tables:    () => renderTables(db, modules, table),
    diff:      () => renderDiff(db),
    modules:   () => renderModules(modules),
    conflicts: () => renderConflicts(modules),
  };

  const nav = VIEWS.map(({ key, label }) =>
    `<a class="-nav-item${view === key ? " -active" : ""}" href="?view=${key}">${label}</a>`
  ).join("");

  const content = await (dispatch[view] ?? dispatch.tables)();

  return `<div class="-m-cms-backend-superuser-db">
  <div class=u2-card>
    <div class="-head">DB Manager</div>
    <nav class="-nav">${nav}</nav>
  </div>
  ${content}
</div>`;
}
