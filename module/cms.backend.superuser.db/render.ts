import { getCtx, html, type HtmlString } from "../core/mod.ts";
import type { Node } from "../cms/mod.ts";
import { renderTables } from "./view/tables.ts";
import { renderDiff } from "./view/diff.ts";
import { renderModules } from "./view/modules.ts";
import { renderConflicts } from "./view/conflicts.ts";

const VIEWS = [
  { key: "tables",    label: "Tables" },
  { key: "diff",      label: "Diff" },
  { key: "modules",   label: "Modules" },
  { key: "conflicts", label: "Conflicts" },
] as const;

type ViewKey = typeof VIEWS[number]["key"];

export async function render(node: Node): Promise<HtmlString> {
  const ctx = getCtx();
  const app = node.app;

  const { db } = app;
  const modules = app.modules.all();
  const view = (ctx.req.query.view ?? "tables") as ViewKey;
  const table = ctx.req.query.table ?? "";

  const dispatch: Record<ViewKey, () => Promise<HtmlString | string> | HtmlString | string> = {
    tables:    () => renderTables(app, db, modules, table),
    diff:      () => renderDiff(app, db),
    modules:   () => renderModules(app, modules),
    conflicts: () => renderConflicts(app, modules),
  };

  const u = ctx.req.url.toURL(); u.searchParams.delete("table");
  const nav = await Promise.all(VIEWS.map(({ key, label }) => {
    u.searchParams.set("view", key);
    return html.async`<a class="-nav-item${view === key ? " -active" : ""}" href="${u.search}">${app.t`${label}`}</a>`;
  }));

  const content = await (dispatch[view] ?? dispatch.tables)();

  return html.async`<div>
  <div class=u2-card>
    <div class=-head>DB Manager</div>
    <nav class=-nav>${nav}</nav>
  </div>
  ${content}
</div>`;
}
