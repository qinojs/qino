import type { Node } from "../cms/mod.ts";
import { hee, html, type Ctx, type HtmlString } from "../core/mod.ts";
import { type Form, formOf } from "../cms.cont.form2/mod.ts";
import { sortedIds } from "./sortedIds.ts";
import options from "./options.ts";
import manifest from "./manifest.json" with { type: "json" };
const { name } = manifest;

const settingsSchema = {
  properties: {
    labelPosition: { type: "string", enum: ["left", "top", "placeholder", "right"], description: "Where the field label sits relative to the input." },
    sort: { type: "string", description: "Comma-separated field ids defining their order." },
    inputs: {
      description: "The fields themselves, keyed by id.",
      additionalProperties: {
        properties: {
          type: { type: "string", description: "Input type, e.g. text, textarea, select, checkbox, radio, email, email-reply-to, flexible." },
          name: { type: "string", description: "Form field name; the label is used when empty." },
          default: { type: "string", description: "Prefilled value." },
          required: { type: "boolean", description: "The form cannot be sent while this field is empty." },
          autocomplete: { type: "string", description: "HTML autocomplete token." },
          "is-recipient": { type: "boolean", description: "For email-reply-to: also send a copy of the entry to this address." },
        },
      },
    },
  },
};

const LABEL_CLASS: Record<string, string> = { top: "-labelTop", placeholder: "-labelPlaceholder", right: "-labelRight" };

function attrs(list: Record<string, string | number | boolean | undefined>): HtmlString {
  let str = "";
  for (const [n, v] of Object.entries(list)) {
    if (v === false || v === undefined || v === "") continue;
    str += v === true ? ` ${n}` : ` ${n}="${hee(v)}"`;
  }
  return html.raw(str);
}

/** A node text without its markup — field labels and choices are plain text. */
async function plain(node: Node, name: string): Promise<string> {
  return String(await node.showText(name)).replace(/<[^>]*>/g, "").trim();
}

/** One field: its markup plus everything it contributes to the form. */
async function field(node: Node, id: string, form: Form | undefined): Promise<HtmlString> {
  const input = node.settings.inputs[id];
  const label = await plain(node, id + "_title");
  const fieldName = String(input.name() ?? "") || label || id;
  const required = !!input.required();
  const labelPosition = String(node.settings.labelPosition() ?? "");
  let type = String(input.type() ?? "") || "text";

  const choices = (await plain(node, id + "_options")).split("\n").map((o) => o.trim()).filter(Boolean);

  const posted = form?.value(fieldName);
  const value = posted ?? String(input.default() ?? "");

  let error: HtmlString | string = "";
  if (form?.sent) {
    if (required && !value) {
      form.errors++;
      error = html`<div class=-error>${await node.app.t`This field is required`}</div>`;
    } else if (type !== "flexible" && value) form.values[label || fieldName] = value;
    if (type === "email-reply-to" && value) {
      form.replyTo ||= value;
      if (input["is-recipient"]()) form.recipients.push(value);
    }
  }
  if (type === "email-reply-to") type = "email";

  let placeholder = await plain(node, id + "_placeholder");
  if (labelPosition === "placeholder") placeholder = label + (required && label ? " *" : "");

  const common = {
    id: fieldName,
    name: fieldName,
    autocomplete: String(input.autocomplete() ?? "") || label.toLowerCase(),
    placeholder,
    required,
  };

  let control: HtmlString;
  switch (type) {
    case "flexible":
      control = await (await node.cont(fieldName, "cms.cont.flexible")).html();
      break;
    case "textarea":
      control = html`<textarea${attrs(common)}>${value}</textarea>`;
      break;
    case "checkbox":
      // an unchecked box sends nothing — the empty hidden twin keeps the field present in the body
      control = html`<input type=hidden name="${fieldName}"><input type=checkbox value=1${attrs({ ...common, checked: !!value })}>`;
      break;
    case "radio": {
      const boxes = choices.map((choice, i) =>
        html`<label><input type=radio${attrs({ ...common, id: undefined, required: required && i === 0, value: choice, checked: value === choice })}> ${choice}</label>`
      );
      control = html`<span class=-radioBoxes>${boxes}</span>`;
      break;
    }
    case "select": {
      const opts = choices.map((choice) => html`<option${attrs({ value: choice, selected: value === choice })}>${choice}</option>`);
      const empty = labelPosition === "placeholder" ? html`<option value="" disabled selected>${placeholder}</option>` : "";
      control = html`<select${attrs(common)}>${empty}${opts}</select>`;
      break;
    }
    default: {
      const listId = choices.length ? `${node.id}_${id}_list` : "";
      const list = listId
        ? html`<datalist id="${listId}">${choices.map((c) => html`<option value="${c}"></option>`)}</datalist>`
        : "";
      control = html`${list}<input${attrs({ ...common, type, value, list: listId })}>`;
    }
  }

  const labelHtml = html`<span class=-label>${await node.cms.text(node, id + "_title", { tag: "span" })}${required && label ? " *" : ""}</span>`;
  return html.async`
    <label class="-item -item-${id}">
      ${labelPosition === "right" ? "" : labelHtml}
      <span>${control}${error}</span>
      ${labelPosition === "right" ? labelHtml : ""}
    </label>`;
}

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  if (node.edit) ctx.res.html.scripts.add(node.modUrl + "pub/edit.mjs");

  // start usable: one field
  if (!Object.keys(node.settings.inputs).length) node.settings.inputs["1"]({});

  const form = await formOf(node);
  const fields = [];
  for (const id of sortedIds(node)) fields.push(await field(node, id, form));

  const warning = node.edit && !form
    ? html`<u2-alert open variant=warning>${await node.app.t`This module belongs inside a "cms.cont.form2" module.`}</u2-alert>`
    : "";

  const cls = LABEL_CLASS[String(node.settings.labelPosition() ?? "")] ?? "";
  return html.async`<div class="-Fields${cls ? " " + cls : ""}">${warning}<div>${fields}</div></div>`;
}

export const cms = {
  node: {
    render,
    options,
    settingsSchema,
    css: ["pub/main.css"],
  },
};
