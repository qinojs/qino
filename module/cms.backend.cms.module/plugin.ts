import { html, type App, type HtmlString } from "../core/mod.ts";
import { backend } from "../cms.backend/mod.ts";
import type { Node } from "../cms/mod.ts";

export const name = "cms.backend.cms.module";
export const needs = ["cms.backend"];

export async function install({ app }: { app: App }) {
  await backend.install(app, name, { en: "Modules", de: "Module" });
}

/** Short type badge from the module name. */
const modType = (n: string) => n.match(/^cms\.(cont|layout|backend|frontend)\./)?.[1] ?? "";

async function render(node: Node): Promise<HtmlString> {
  const app = node.app, t = app.t;

  const used = new Map((await app.db.query`
    SELECT m.name, (SELECT COUNT(*) FROM page WHERE module = m.name) AS used FROM module m`)
    .map((r) => [String(r.name), Number(r.used)]));

  const trs: HtmlString[] = [];
  let total = 0;
  for (const modName of Object.keys(app.modules.all()).sort()) {
    if (!app.modules.get(modName)!.plugin.cms?.node?.render) continue;
    if (!used.has(modName)) continue;
    total++;
    trs.push(html`<tr>
      <td>${modName}
      <td>${modType(modName)}
      <td style="text-align:right">${used.get(modName) || ""}`);
  }

  return html.async`
<div class="u2-card -main" style="max-height:90vh; overflow:auto; flex-grow:0">
  <table class="u2-table -Sticky">
    <thead><tr>
      <th>${t`Module`}
      <th>${t`Type`}
      <th>${t`Used`}
    <tbody>${html.join(trs)}
    <tfoot><tr>
      <td colspan=3>${t`Total`}: ${total}
  </table>
</div>`;
}

export function backendDashboardWidget(app: App): Promise<HtmlString> {
  return html.async`<div class=-body>
    <b>${app.db.one`SELECT count(*) FROM module`}</b> ${app.t`modules`}
  </div>`;
}

export const cms = { node: { render } };
