import { html } from "@qino/qino";

import type { HtmlString } from "@qino/qino";
import type { CheckResult } from "./healthRegistry.ts";

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The buttons (with optional input form) that run a check's solutions through the node api. */
export function solutionsHtml(type: string, item: string, data: NonNullable<CheckResult>): HtmlString | string {
  const solutions = Object.entries(data.solutions ?? {});
  if (!solutions.length) return "";

  if (solutions.length === 1) {
    const [solution, solveData] = solutions[0];
    const formFields: HtmlString[] = [];
    for (const [fname, field] of Object.entries(solveData.form ?? {})) {
      const inputType = typeof field.type === "string" ? field.type : "text";
      formFields.push(html`<tr><td>${cap(fname)}:<td><input name="${fname}" type="${inputType}">`);
    }
    return html`<form>
  ${formFields.length ? html`<table><tbody style="vertical-align:baseline">${formFields}</table>` : ""}
  <button data-type="${type}" data-item="${item}" data-solution="${solution}">${cap(solution)}</button>
</form>`;
  }

  const menuItems = solutions.map(([solution]) =>
    html`<li><button data-type="${type}" data-item="${item}" data-solution="${solution}">${cap(solution)}</button>`
  );
  return html`<form><u2-menubutton>
  <button type=button>solve ▾</button>
  <menu>${menuItems}</menu>
</u2-menubutton></form>`;
}
