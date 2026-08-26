import { errMsg, html, sql } from "@qino/qino";
import { postedVars } from "@qino/qino/cms";
import { backend } from "@qino/qino/cms.backend";
import { publish, targets as socialTargets } from "@qino/qino/social";

import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString, Row } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Target } from "@qino/qino/social";

const { name } = manifest;
const LIMIT = 50;

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

function providerNames(app: App): string[] {
  return [...new Set(app.modules.linked().flatMap((mod) => {
    const provider = mod.plugin.socialProvider;
    return provider ? [String(provider.name)] : [];
  }))];
}

const providerLabel = (name: string) => name[0].toUpperCase() + name.slice(1);

export async function history(app: App): Promise<HtmlString> {
  const logIds = await app.db.col`SELECT log_id FROM social_post WHERE log_id IS NOT NULL
    GROUP BY log_id ORDER BY MAX(id) DESC LIMIT ${LIMIT}`;
  const rows = logIds.length
    ? await app.db.query`SELECT * FROM social_post WHERE ${sql.in("log_id", logIds)} ORDER BY id DESC`
    : [];
  const posts = new Map<number, { text: string; byProvider: Map<string, Row[]> }>();
  for (const row of rows) {
    const logId = Number(row.log_id);
    if (!posts.has(logId)) posts.set(logId, { text: String(row.text), byProvider: new Map() });
    const deliveries = posts.get(logId)!.byProvider;
    const name = String(row.provider);
    deliveries.set(name, [...deliveries.get(name) ?? [], row]);
  }
  const names = [...new Set([...providerNames(app), ...rows.map((row) => String(row.provider))])];
  const [sent, error, notSent, empty] = await Promise.all([
    app.t`Sent`, app.t`Error`, app.t`Not sent`, app.t`No posts yet.`,
  ]);
  const status = (deliveries: Row[] | undefined) => {
    if (!deliveries?.length || !deliveries.every((row) => row.sent != null)) {
      const message = deliveries?.find((row) => row.error)?.error;
      return message
        ? html`<span title="${message}"><u2-ico inline icon=error aria-label="${error}">!</u2-ico> ${error}</span>`
        : html`<span>${notSent}</span>`;
    }
    const icon = html`<u2-ico inline icon=check_circle aria-label="${sent}">✓</u2-ico>`;
    const url = deliveries.find((row) => row.url)?.url;
    return url ? html`<a href="${url}" target=_blank>${icon}</a>` : icon;
  };

  return html.async`<div class=u2-card cms-part=posts style="flex:1 1 40rem">
    <div class=-head>${app.t`Posts`}</div>
    <table class=u2-table>
      <thead><tr>
        <th>${app.t`Post`}
        ${names.map((name) => html`<th>${providerLabel(name)}`)}
      <tbody>${posts.size
        ? [...posts.values()].map((post) => html`<tr>
          <td>${post.text}
          ${names.map((name) => html`<td>${status(post.byProvider.get(name))}`)}`)
        : html`<tr><td colspan="${names.length + 1}">${empty}`}
    </table>
  </div>`;
}

async function render(node: Node): Promise<HtmlString> {
  const vars = postedVars(node.id);
  const available = await socialTargets(node.app);
  const note = await act(node.app, vars, available);
  const text = vars?.publish == null ? "" : String(vars.text ?? "");
  const choices = available.length
    ? available.map((target, i) => html`<div><label>
        <input type=checkbox name=target value="${i}" checked> <strong>${providerLabel(target.provider)}</strong> <small>${target.label}</small>
      </label></div>`)
    : html.async`<p>${node.app.t`No social targets configured.`}</p>`;

  return html.async`<div class=u2-flex style="flex: 1 1 auto;">
      <div class=u2-card style="flex:0 1 27rem">
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
      ${await history(node.app)}
  </div>`;
}

export const cms = { node: { render } };
