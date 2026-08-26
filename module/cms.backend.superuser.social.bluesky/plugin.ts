import { errMsg, html } from "@qino/qino";
import { postedVars } from "@qino/qino/cms";
import { backend } from "@qino/qino/cms.backend";
import { socialProvider } from "@qino/qino/social.bluesky";

import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Bluesky", de: "Bluesky" });
}

async function act(app: App, vars: Record<string, unknown> | undefined): Promise<string> {
  if (!vars) return "";
  try {
    if (vars.save != null) {
      const url = String(vars.url ?? "").trim();
      const handle = String(vars.handle ?? "").trim();
      const password = String(vars.appPassword ?? "").trim();
      if (!url || !handle) return await app.t`A server URL and handle are required.`;
      const settings = app.settings["social.bluesky"];
      await Promise.all([settings.url(url), settings.handle(handle)]);
      if (password) await settings.appPassword(password);
    }
    const [target] = await socialProvider.targets(app);
    return target ? await app.t`Connected to ${target.label}.` : await app.t`No account found.`;
  } catch (e) {
    return errMsg(e);
  }
}

async function render(node: Node): Promise<HtmlString> {
  const note = await act(node.app, postedVars(node.id));
  const settings = node.app.settings["social.bluesky"];
  const url = String(await settings.url ?? "https://bsky.social");
  const handle = String(await settings.handle ?? "");
  const configured = Boolean(await settings.appPassword);
  return html.async`<div class=u2-card>
    <div class=-head>${node.app.t`Bluesky`}</div>
    <form class=-body method=post>
      ${node.cms.formFields(node)}
      ${note ? html`<p>${note}</p>` : ""}
      <p><small><a href="https://bsky.app/settings/app-passwords" target=_blank rel=noopener>${node.app.t`Open Bluesky app passwords`}</a></small>
      <u2-fields>
        ${node.app.t`Server URL`} <input type=url name=url value="${url}" required>
        ${node.app.t`Handle`} <input name=handle value="${handle}" placeholder="name.bsky.social" required>
        ${node.app.t`App password`} <input type=password name=appPassword autocomplete=new-password
          placeholder="${configured ? await node.app.t`Configured — leave empty to keep` : ""}">
      </u2-fields>
      <button name=save value=1>${node.app.t`Save and check`}</button>
      <button name=check value=1>${node.app.t`Check`}</button>
    </form>
  </div>`;
}

export const cms = { node: { render } };
