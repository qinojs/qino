import { html, type HtmlString } from "../../module/core/mod.ts";
import type { Node } from "../../module/cms/mod.ts";
import manifest from "./manifest.json" with { type: "json" };
const { name } = manifest;

async function render(node: Node): Promise<HtmlString> {
  const raw = await node.settings.elements();
  const elements = raw && typeof raw === "object" ? raw as Record<string, Record<string, unknown>> : {};
  const rows: HtmlString[] = [];
  for (const [id, field] of Object.entries(elements)) {
    const type = String(field?.type ?? "text");
    if (type === "description") {
      rows.push(html`<tr><td colspan=2>${await node.showText(id + "_desc")}</td></tr>`);
      continue;
    }
    const label = await node.showText(id + "_name");
    const required = field?.obl ? html.raw(" required") : "";
    const options = String(await node.showText(id + "_value")).split(";").map((value) => value.trim()).filter(Boolean);
    let input: HtmlString;
    if (type === "textarea") input = html`<textarea name="${id}"${required}></textarea>`;
    else if (type === "select") input = html`<select name="${id}"${required}>${html.join(options.map((value) => html`<option>${value.replace(/\([^)]*\)$/, "")}`))}</select>`;
    else if (type === "radio") input = html`<span>${html.join(options.map((value) => html`<label><input type=radio name="${id}" value="${value}"${required}> ${value.replace(/\([^)]*\)$/, "")}</label>`), " ")}</span>`;
    else if (type === "checkbox") input = html`<label><input type=checkbox name="${id}" value="${options[0] || "1"}"${required}> ${options[0] || ""}</label>`;
    else input = html`<input type="${["email", "url"].includes(type) ? type : "text"}" name="${id}"${required}>`;
    rows.push(html`<tr><td><label>${label}${field?.obl ? "*" : ""}</label></td><td>${input}</td></tr>`);
  }
  return html`<div><fieldset disabled><table class=mailform>${html.join(rows)}<tr><td></td><td><button>${await node.showText("sendButton")}</button></td></tr></table></fieldset></div>`;
}

export const cms = { node: { render } };
