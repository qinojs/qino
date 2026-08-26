import { errMsg, html } from "@qino/qino";
import { postedVars } from "@qino/qino/cms";
import { backend } from "@qino/qino/cms.backend";
import { socialProvider } from "@qino/qino/social.telegram";

import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Telegram", de: "Telegram" });
}

async function act(app: App, vars: Record<string, unknown> | undefined): Promise<string> {
  if (!vars) return "";
  try {
    if (vars.save != null) {
      const targets = String(vars.targets ?? "").trim();
      if (!targets) return await app.t`At least one target is required.`;
      await app.settings["social.telegram"].targets(targets);
    }
    const found = await socialProvider.targets(app);
    return found.length
      ? await app.t`Connected to ${found.map((target) => target.label).join(", ")}.`
      : await app.t`No target found.`;
  } catch (e) {
    return errMsg(e);
  }
}

async function render(node: Node): Promise<HtmlString> {
  const note = await act(node.app, postedVars(node.id));
  const targets = String(await node.app.settings["social.telegram"].targets ?? "");
  return html.async`<div class=u2-card>
    <div class=-head>${node.app.t`Telegram`}</div>
    <form class=-body method=post>
      ${node.cms.formFields(node)}
      ${note ? html`<p>${note}</p>` : ""}
      <p><small><a href="https://t.me/BotFather" target=_blank rel=noopener>${node.app.t`Open BotFather`}</a></small>
      <u2-fields>
        ${node.app.t`Targets`} <input name=targets value="${targets}" placeholder="-1001234567890, @channel" required>
      </u2-fields>
      <button name=save value=1>${node.app.t`Save and check`}</button>
      <button name=check value=1>${node.app.t`Check`}</button>
      <p><small>${node.app.t`Uses the bot token configured in Messaging → Telegram. The bot must be an administrator of each channel.`}</small>
    </form>
  </div>`;
}

export const cms = { node: { render } };
