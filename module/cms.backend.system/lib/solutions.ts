import { html } from "@qino/qino";

import type { HtmlString } from "@qino/qino";
import type { CheckResult } from "./healthRegistry.ts";

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The buttons (with optional input form) that run a check's solutions through the node api. */
export function solutionsHtml(data: NonNullable<CheckResult>): HtmlString | string {
  const solutions = Object.entries(data.solutions ?? {});
  if (!solutions.length) return "";

  if (solutions.length === 1) {
    const [solution, solveData] = solutions[0];
    const formFields = Object.entries(solveData.form ?? {}).map(([fname, field]) =>
      html`<tr><td>${cap(fname)}:<td><input name="${fname}" type="${typeof field.type === "string" ? field.type : "text"}">`
    );
    return html`<form>
  ${formFields.length ? html`<table><tbody style="vertical-align:baseline">${formFields}</table>` : ""}
  <button data-solution="${solution}">${cap(solution)}</button>
</form>`;
  }

  const menuItems = solutions.map(([solution]) =>
    html`<li><button data-solution="${solution}">${cap(solution)}</button>`
  );
  return html`<form><u2-menubutton>
  <button type=button>solve ▾</button>
  <menu>${menuItems}</menu>
</u2-menubutton></form>`;
}
