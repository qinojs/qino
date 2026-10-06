import { errMsg, html } from "@qino/qino";
import { command, run } from "@qino/qino/home";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

type Range = { min?: number; max?: number; step?: number };

const range = (node: Node): Range => Object.fromEntries((["min", "max", "step"] as const)
  .map((key) => [key, node.settings[key]()]).filter(([, value]) => typeof value === "number"));

/** Placing the block publishes its command: page access decides who can run it. */
async function render(node: Node): Promise<HtmlString> {
  const t = node.app.t, id = Number(node.settings.command() ?? 0);
  if (!id) return html.async`<div><p>${t`Select a command in the block settings.`}</p></div>`;
  try {
    const found = await command(node.app, id);
    const label = String(node.settings.label() ?? "") || found.name;
    if (!found.parameter) return html.async`<div><button type=button data-run>${label}</button></div>`;
    const { min, max, step } = range(node), slider = min !== undefined && max !== undefined;
    return html.async`<div><form data-run class=u2-flex>
      <label>${label}
        <input name=value required ${slider
          ? html`type=range min="${min}" max="${max}" step="${step ?? "any"}" value="${(min + max) / 2}"`
          : ""}>
      </label>
      ${slider ? html`<output>${(min + max) / 2}</output>` : ""}
      <button>${t`Set`}</button>
    </form></div>`;
  } catch (error) {
    return html`<div><p role=alert>${errMsg(error)}</p></div>`;
  }
}

/** Runs only the configured command; a value only fills its parameter, within the block's range. */
async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  const id = Number(node.settings.command() ?? 0);
  if (!id || vars.run === undefined) return null;
  try {
    const { value } = vars, { min, max } = range(node);
    const bounded = min !== undefined || max !== undefined;
    if (value !== undefined && bounded
      && (typeof value !== "number" || value < (min ?? -Infinity) || value > (max ?? Infinity)))
      return { ok: false, message: await node.app.t`The value is out of range.` };
    await run(node.app, id, value === undefined ? {} : { value });
    return { ok: true };
  } catch (error) { return { ok: false, message: errMsg(error) }; }
}

export const cms = {
  node: {
    render,
    api,
    js: ["pub/main.js"],
    settingsSchema: {
      properties: {
        command: { type: "integer", minimum: 0, default: 0, description: "Stored home command ID." },
        label: { type: "string", default: "", description: "Shown text; empty uses the command's name." },
        min: { type: "number", description: "With max: the value is set with a slider and limited to this range." },
        max: { type: "number", description: "With min: the value is set with a slider and limited to this range." },
        step: { type: "number", description: "Slider step; empty allows any value." },
      },
    },
  },
};
