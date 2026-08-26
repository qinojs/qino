import { errMsg, html } from "@qino/qino";
import { postedVars } from "@qino/qino/cms";
import { backend } from "@qino/qino/cms.backend";
import { publish, targets as socialTargets } from "@qino/qino/social";

import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Target } from "@qino/qino/social";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Social", de: "Social" });
}

async function act(app: App, vars: Record<string, unknown> | undefined, available: Target[]): Promise<string> {
  if (!vars || vars.publish == null) return "";
  try {
    const text = String(vars.text ?? "").trim();
    const indexes = [vars.target ?? []].flat().map(Number);
    const selected = indexes.filter((i) => Number.isSafeInteger(i) && available[i]).map((i) => available[i]);
    if (!text) return await app.t`Text is required.`;
    if (!selected.length) return await app.t`Select at least one target.`;
    const rows = await publish(app, selected, text);
    const sent = rows.filter((row) => row.sent != null).length;
    const errors = rows.flatMap((row) => row.error ? [String(row.error)] : []);
    return [await app.t`Published to ${sent} of ${rows.length} targets.`, ...errors].join(" ");
  } catch (e) {
    return errMsg(e);
  }
}

async function render(node: Node): Promise<HtmlString> {
  const vars = postedVars(node.id);
  const available = await socialTargets(node.app);
  const note = await act(node.app, vars, available);
  const text = vars?.publish == null ? "" : String(vars.text ?? "");
  const choices = available.length
    ? available.map((target, i) => html`<label>
        <input type=checkbox name=target value="${i}"> ${target.label} <small>${target.provider}</small>
      </label>`)
    : html.async`<p>${node.app.t`No social targets configured.`}</p>`;

  return html.async`<div>
    <div class=u2-flex>
      <div class=u2-card>
        <div class=-head>${node.app.t`New post`}</div>
        <form class=-body method=post>
          ${node.cms.formFields(node)}
          ${note ? html`<p>${note}</p>` : ""}
          <u2-fields>
            ${node.app.t`Text`} <textarea name=text rows=5 required>${text}</textarea>
          </u2-fields>
          <fieldset>
            <legend>${node.app.t`Targets`}</legend>
            ${choices}
          </fieldset>
          <button name=publish value=1>${node.app.t`Publish`}</button>
        </form>
      </div>
    </div>
  </div>`;
}

export const cms = { node: { render } };
