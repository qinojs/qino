import { html } from "@qino/qino";

import { sortedIds } from "./sortedIds.ts";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const TYPES: Record<string, string> = {
  text: "Text field",
  textarea: "Text block",
  select: "Dropdown",
  checkbox: "Checkbox",
  radio: "Radio buttons",
  email: "E-Mail",
  "email-reply-to": "E-Mail (sender)",
  number: "Number",
  url: "URL",
  date: "Date",
  time: "Time",
  "datetime-local": "Local date / time",
  month: "Month",
  week: "Week",
  range: "Range",
  tel: "Phone",
  color: "Color",
  flexible: "Mixed content",
};

// A useful subset of the HTML autocomplete tokens; offered as a datalist, not enforced.
const AUTOCOMPLETES = [
  "off", "name", "given-name", "family-name", "nickname", "username", "new-password", "current-password",
  "organization", "organization-title", "street-address", "address-line1", "address-line2",
  "address-level2", "address-level1", "country", "country-name", "postal-code",
  "bday", "sex", "url", "tel", "email", "impp",
];

const POSITIONS: Record<string, string> = { left: "Left", top: "Above", placeholder: "Inside the field", right: "Right" };

async function fieldRow(node: Node, id: string): Promise<HtmlString> {
  const t = node.app.t;
  const input = node.settings.inputs[id];
  const type = String(input.type() ?? "") || "text";
  const title = await node.text(id + "_title");
  const choices = await node.text(id + "_options");
  const placeholder = await node.text(id + "_placeholder");
  const set = (key: string) => html.raw(` data-node="${node.id}" data-key="${key}" data-fields1-setting`);

  const typeOptions = Object.entries(TYPES).map(([v, label]) =>
    html`<option value="${v}"${v === type ? html.raw(" selected") : ""}>${label}</option>`
  );

  return html.async`
<div class=-field data-id="${id}" tabindex=-1>
  <div class=-head>
    <select${set(`inputs.${id}.type`)} data-reload-options>${typeOptions}</select>
    <input value="${await title.string()}" cmstxt="${title.id}">
    <button type=button class=-handle title="${await t`Reorder`}">↕</button>
    <button type=button class=-remove data-node="${node.id}" data-id="${id}">✕</button>
  </div>
  ${
    type === "flexible" ? "" : html.async`
  <div class=-more>
    <label><input type=checkbox${set(`inputs.${id}.required`)}${input.required() ? html.raw(" checked") : ""}> ${t`Required`}</label>
    ${
      type === "email-reply-to"
        ? html.async`<label><input type=checkbox${set(`inputs.${id}.is-recipient`)}${input["is-recipient"]() ? html.raw(" checked") : ""}> ${t`Send a copy to this address`}</label>`
        : ""
    }
    <label>${t`Choices (one per line):`}<textarea cmstxt="${choices.id}">${await choices.string()}</textarea></label>
    <label>${t`Default value:`}<input value="${input.default()}"${set(`inputs.${id}.default`)}></label>
    <label>${t`Placeholder:`}<input value="${await placeholder.string()}" cmstxt="${placeholder.id}"></label>
    <label>${t`Autocomplete:`}<input list=fields1-autocomplete value="${input.autocomplete()}"${set(`inputs.${id}.autocomplete`)}></label>
  </div>`
  }
</div>`;
}

export default async function (node: Node, _vars: unknown): Promise<HtmlString> {
  const t = node.app.t;
  const position = String(node.settings.labelPosition() ?? "left");

  const rows = [];
  for (const id of sortedIds(node)) rows.push(await fieldRow(node, id));

  return html.async`
<label>
  ${t`Label position:`}
  <select data-node="${node.id}" data-key=labelPosition data-fields1-setting>
    ${Object.entries(POSITIONS).map(([v, label]) => html`<option value="${v}"${v === position ? html.raw(" selected") : ""}>${label}</option>`)}
  </select>
</label>

<div class=-fields data-node="${node.id}">${rows}</div>

<datalist id=fields1-autocomplete>
  ${AUTOCOMPLETES.map((a) => html`<option value="${a}"></option>`)}
</datalist>

<button type=button class=-add data-node="${node.id}">${t`Add field`}</button>`;
}
