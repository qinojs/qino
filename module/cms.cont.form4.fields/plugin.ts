import { getCtx, hee, html } from "@qino/qino";

import api from "./nodeApi.ts";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Form } from "@qino/qino/cms.cont.form4";

const settingsSchema = {
  properties: {
    sort: { type: "string", description: "Comma-separated field names defining their order." },
    fields: {
      description: "The fields, keyed by the name their label was turned into.",
      additionalProperties: {
        properties: {
          type: { type: "string", description: "Input type: text, textarea, email, number, date, checkbox, select, radio, file." },
          required: { type: "boolean", description: "The form cannot be sent while this field is empty." },
          default: { type: "string", description: "Prefilled value." },
          autocomplete: { type: "string", description: "HTML autocomplete token." },
          disableif: { type: "string", description: "Disable this field while a condition on another one holds, in u2-disableif syntax: \"age>33\", \"kind=other\", \"newsletter\", \"!newsletter\"." },
          "is-recipient": { type: "boolean", description: "For email: also send a copy of the entry to this address." },
        },
      },
    },
  },
};

/** Field names in display order: those listed in `sort` first, then the rest. */
function sortedNames(node: Node): string[] {
  const all = Object.keys(node.settings.fields);
  const sorted = String(node.settings.sort() ?? "").split(",").filter((name) => all.includes(name));
  return [...sorted, ...all.filter((name) => !sorted.includes(name))];
}

/** A node text with its markup stripped; `plain()` also drops the surrounding space. */
const rawText = async (node: Node, name: string) => String(await node.showText(name)).replace(/<[^>]*>/g, "");
const plain = async (node: Node, name: string) => (await rawText(node, name)).trim();

/**
 * The choices of a select or radio, one per line. An empty line stays a choice: it is how a
 * select gets the empty entry it needs when nothing may be preselected — so this cannot go
 * through `plain()`, whose trim would eat exactly that line.
 */
async function choicesOf(node: Node, name: string): Promise<string[]> {
  const lines = (await rawText(node, name + "_options")).replace(/\r/g, "").split("\n").map((c) => c.trim());
  while (lines.length && lines.at(-1) === "") lines.pop(); // the newline behind the last line is none
  return lines;
}

function attrs(list: Record<string, string | number | boolean | undefined>): HtmlString {
  let str = "";
  for (const [n, v] of Object.entries(list)) {
    if (v === false || v === undefined || v === "") continue;
    str += v === true ? ` ${n}` : ` ${n}="${hee(v)}"`;
  }
  return html.raw(str);
}

/** One field: its markup plus everything it contributes to the form. */
async function field(node: Node, name: string, form: Form | undefined, ctx: Ctx): Promise<HtmlString> {
  const set = node.settings.fields[name];
  const type = String(set.type() ?? "") || "text";
  const label = await plain(node, name + "_title") || name;
  const required = !!set.required();
  const choices = await choicesOf(node, name);

  const posted = form?.value(name);
  const value = posted ?? String(set.default() ?? "");

  let error: HtmlString | string = "";
  if (form?.sent) {
    if (type === "file") {
      // ReqBody keeps only the last file per field name
      const file = await ctx.req.files[name]?.catch(() => undefined);
      if (file?.name) form.files.push({ field: name, upload: file });
      else if (required) form.errors++;
    } else if (required && !value) {
      form.errors++;
      error = html`<div class=-error>${await node.app.t`This field is required`}</div>`;
    } else if (value) {
      form.values[name] = type === "number" ? Number(value) : type === "checkbox" ? true : value;
      form.labels[name] = label;
      if (type === "email") {
        form.replyTo ||= value;
        if (set["is-recipient"]()) form.recipients.push(value);
      }
    }
  }

  const placeholder = await plain(node, name + "_placeholder");

  /* The condition names other fields of this form — that is what the readable names are for.
     The attribute's script is not registered here: `u2.assets()` without a version would pull
     qino's u2 onto a page that pins its own, and the site's version is not ours to know. The
     layout's `u2/auto.js` fetches it from the release the site uses — at the price of a short
     flicker, while a field that should start disabled is still enabled. */
  const disableif = String(set.disableif() ?? "").trim();

  const common = {
    id: `${node.id}_${name}`,
    name,
    autocomplete: String(set.autocomplete() ?? "") || name,
    placeholder,
    required,
    "u2-disableif": disableif,
  };

  let control: HtmlString;
  switch (type) {
    case "textarea":
      control = html`<textarea${attrs(common)}>${value}</textarea>`;
      break;
    case "checkbox":
      // an unchecked box sends nothing — the empty hidden twin keeps the field present in the body
      control = html`<input type=hidden name="${name}"><input type=checkbox value=1${attrs({ ...common, checked: !!value })}>`;
      break;
    case "radio": {
      const boxes = choices.filter(Boolean).map((choice, i) =>
        html`<label><input type=radio${attrs({ ...common, id: undefined, required: required && i === 0, value: choice, checked: value === choice })}> ${choice}</label>`
      );
      control = html`<span class="u2-flex -radioBoxes">${boxes}</span>`;
      break;
    }
    case "select": {
      const opts = choices.map((choice) => html`<option${attrs({ value: choice, selected: value === choice })}>${choice}</option>`);
      control = html`<select${attrs(common)}>${opts}</select>`;
      break;
    }
    case "file":
      control = html`<input type=file${attrs({ ...common, accept: choices.filter(Boolean).join(",") })}>`;
      break;
    default:
      control = html`<input${attrs({ ...common, type, value })}>`;
  }

  return html.async`<tr class="-item -item-${name}">
      <th scope=row><label for="${common.id}">${await node.cms.text(node, name + "_title", { tag: "span" })}${required ? " *" : ""}</label>
      <td>${control}${error}`;
}

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  /* One walk up answers both questions. Which form is open reads the state form4 fills while
     it renders — and it is read here rather than imported, because form4 depends on this
     module and a dependency back would be a cycle. Whether we sit in a form at all is the
     tree's answer, and only the tree knows it when this node renders alone: a panel reload
     leaves the parent unrendered and no form open. */
  const path = [...(await node.path()).values()].reverse();
  const open: Map<number, Form> | undefined = getCtx().state.form4;
  const form = open?.size ? path.map((n) => open.get(n.id)).find(Boolean) : undefined;

  const fields = [];
  for (const name of sortedNames(node)) fields.push(await field(node, name, form, ctx));

  const warning = await node.edit() && !path.some((n) => n.vs.module === "cms.cont.form4")
    ? html`<tr><td colspan=2><u2-alert open variant=warning>${await node.app.t`This module belongs inside a "cms.cont.form4" module.`}</u2-alert>`
    : "";

  return html.async`<table class="u2-table -Fields -Flex -NoSideGaps">${warning}${fields}</table>`;
}

export const cms = {
  node: {
    render,
    widget: "pub/widget.js",
    settingsSchema,
    api,
    css: ["pub/main.css"],
  },
};
