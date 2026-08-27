import { html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { cap, getHealthChecks, healthApi, solutionsHtml } from "@qino/qino/cms.backend.system";
import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";
import type { CheckResult } from "@qino/qino/cms.backend.system";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Health", de: "Health" });
}

const ms = (n: number) => n.toFixed(n < 10 ? 1 : 0) + " ms";

/** What is known without running the check; the remaining cells arrive through the `check` part.
 *  The type sorts by severity, not alphabetically — hence its rank as sort value. */
const knownCells = (type: string, rank: number, check: string, mod?: string, passed = false) =>
  html`<td>${mod ?? ""}<td data-value="${rank}"><span class="u2-badge -${passed ? "passed" : type}">${cap(type)}</span><td>${cap(check)}`;

// Every check as an empty row — the client fills them in one by one.
async function table(node: Node): Promise<HtmlString> {
  const t = node.app.t;
  const types = await getHealthChecks(node.app);

  const rows: HtmlString[] = [];
  for (const [rank, [type, checks]] of Object.entries(types).entries()) {
    for (const [check, checkFn] of Object.entries(checks)) {
      rows.push(html`<tr data-type="${type}" data-item="${check}">${knownCells(type, rank, check, checkFn.mod)}<td>…<td><td class=-time>`);
    }
  }

  return html.async`<u2-table><table class=u2-table>
  <thead>
    <tr>
      <th data-sort-handler>${t`Module`}
      <th data-sort-handler>${t`Type`}
      <th data-sort-handler>${t`Check`}
      <th data-sort-handler>${t`Message`}
      <th>${t`Actions`}
      <th data-sort-handler class=-time>${t`Time`}
  <tbody>${rows}
  <tfoot>
    <tr>
      <td colspan=5>${rows.length} ${t`checks`}
      <td class="-time -total">
</table></u2-table>`;
}

// One row, run on demand: the check itself plus how long it took.
async function check(node: Node, { vars }: { vars: Record<string, unknown> }): Promise<HtmlString> {
  const type = String(vars.type);
  const item = String(vars.item);
  const types = await getHealthChecks(node.app);
  const checkFn = types[type]?.[item];
  if (!checkFn) return html`<td colspan=6>`;

  let data: CheckResult;
  let failed = "";
  const started = performance.now();
  try { data = await checkFn(); } catch (e) { failed = String(e); }
  const took = performance.now() - started;

  const message = failed
    ? html`<span class=-failed>${failed}</span>`
    : data?.info
    ? html.raw(data.info)
    : data
    ? ""
    : html`<span class=-ok>&#10003;</span>`;

  return html`${knownCells(type, Object.keys(types).indexOf(type), item, checkFn.mod, !data && !failed)}
  <td>${message}
  <td>${data ? solutionsHtml(type, item, data) : ""}
  <td class=-time data-value="${took.toFixed(1)}">${ms(took)}`;
}

function render(node: Node): Promise<HtmlString> {
  const t = node.app.t;
  return html.async`
<div class=u2-card style="flex:0 1 auto">
  <div class=-head>${t`Health`}</div>
  <div class=-body>
    <label><input type=checkbox data-all> ${t`All checks`}</label>
    <button data-refresh type=button>${t`Refresh`}</button>
  </div>
  <div class="-body -only-issues" cms-part=table style="padding:0;overflow:auto">${table(node)}</div>
</div>`;
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    js: ["pub/main.js"],
    render,
    api: healthApi,
    parts: { table, check },
  },
};
