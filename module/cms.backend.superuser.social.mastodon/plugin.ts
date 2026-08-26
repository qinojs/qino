import { errMsg, html } from "@qino/qino";
import { postedVars } from "@qino/qino/cms";
import { backend } from "@qino/qino/cms.backend";
import { socialProvider } from "@qino/qino/social.mastodon";

import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Mastodon", de: "Mastodon" });
}

async function act(app: App, vars: Record<string, unknown> | undefined): Promise<string> {
  if (!vars) return "";
  try {
    if (vars.save != null) {
      const url = String(vars.url ?? "").trim();
      const token = String(vars.accessToken ?? "").trim();
      if (!url) return await app.t`A server URL is required.`;
      await app.settings["social.mastodon"].url(url);
      if (token) await app.settings["social.mastodon"].accessToken(token);
    }
    const [target] = await socialProvider.targets(app);
    return target ? await app.t`Connected to ${target.label}.` : await app.t`No account found.`;
  } catch (e) {
    return errMsg(e);
  }
}

async function render(node: Node): Promise<HtmlString> {
  const note = await act(node.app, postedVars(node.id));
  const settings = node.app.settings["social.mastodon"];
  const url = String(await settings.url ?? "");
  const configured = Boolean(await settings.accessToken);
  return html.async`<div class=u2-card>
    <div class=-head>${node.app.t`Mastodon`}</div>
    <form class=-body method=post>
      ${node.cms.formFields(node)}
      ${note ? html`<p>${note}</p>` : ""}
      <u2-fields>
        ${node.app.t`Server URL`} <input type=url name=url value="${url}" placeholder="https://mastodon.social" required>
        ${node.app.t`Access token`} <input type=password name=accessToken autocomplete=off
          placeholder="${configured ? await node.app.t`Configured — leave empty to keep` : ""}">
      </u2-fields>
      <button name=save value=1>${node.app.t`Save and check`}</button>
      <button name=check value=1>${node.app.t`Check`}</button>
    </form>
  </div>`;
}

export const cms = { node: { render } };
