import { errMsg, html } from "@qino/qino";
import { postedVars } from "@qino/qino/cms";
import { backend } from "@qino/qino/cms.backend";
import { socialProvider } from "@qino/qino/social.x";

import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "X", de: "X" });
}

async function act(app: App, vars: Record<string, unknown> | undefined): Promise<string> {
  if (!vars) return "";
  try {
    if (vars.save != null) {
      const token = String(vars.accessToken ?? "").trim();
      if (!token) return await app.t`An access token is required.`;
      await app.settings["social.x"].accessToken(token);
    }
    const [target] = await socialProvider.targets(app);
    return target ? await app.t`Connected to ${target.label}.` : await app.t`No account found.`;
  } catch (e) {
    return errMsg(e);
  }
}

async function render(node: Node): Promise<HtmlString> {
  const note = await act(node.app, postedVars(node.id));
  const configured = Boolean(await node.app.settings["social.x"].accessToken);
  return html.async`<div class=u2-card>
    <div class=-head>${node.app.t`X`}</div>
    <form class=-body method=post>
      ${node.cms.formFields(node)}
      ${note ? html`<p>${note}</p>` : ""}
      <u2-fields>
        ${node.app.t`User access token`} <input type=password name=accessToken autocomplete=off
          placeholder="${configured ? await node.app.t`Configured — enter a token to replace` : ""}">
      </u2-fields>
      <button name=save value=1>${node.app.t`Save and check`}</button>
      <button name=check value=1>${node.app.t`Check`}</button>
      <p><small>${node.app.t`Requires tweet.read, users.read and tweet.write in the X Developer Console.`}</small>
    </form>
  </div>`;
}

export const cms = { node: { render } };
