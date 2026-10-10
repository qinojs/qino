import { html } from "@qino/qino";
import { commands, providers } from "@qino/qino/home";
import { templates, virtuals } from "@qino/qino/home.virtual";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export function render(node: Node): Promise<HtmlString> {
  return html.async`<div class=u2-flex>
    <div cms-part=list style="display:contents">${list(node)}</div>
  </div>`;
}

const options = (rows: { id: number; name: string }[]) =>
  rows.map((row) => html`<option value="${row.id}">${row.name} (#${row.id})</option>`);

/** Virtual entities, a form to add one, and the device templates. */
export async function list(node: Node): Promise<HtmlString> {
  const app = node.app, t = app.t;
  const [all, orders, rows] = await Promise.all([providers(app), commands(app), virtuals(app)]);
  const own = all.filter((row) => row.adapter === "virtual"), others = all.filter((row) => row.adapter !== "virtual");
  const named = (list: { id: number; name: string }[], id: number) =>
    list.find((row) => row.id === id)?.name ?? `#${id}`;
  if (!own.length) return html.async`<section class=u2-card>
    <div class=-head>${t`Virtual entities`}</div>
    <p>${t`Virtual entities belong to a provider with the adapter Virtual.`}</p>
    <p><button type=button data-new-provider>${t`Create virtual provider`}</button></p>
  </section>`;
  const id = (name: string) => `${node.id}-${name}`;
  return html.async`<section class=u2-card>
      <div class=-head>${t`Virtual entities`}</div>
      ${rows.length ? html.async`<table class=u2-table>
        <thead><tr>
          <th>${t`Name`}
          <th>${t`Reads`}
          <th>${t`Sets through`}
          <th>${t`Value`}
          <th>
        <tbody>${rows.map((row) => html.async`<tr>
          <td>${row.name}<br><code>${named(all, row.provider)} · ${row.id}</code>
          <td>${row.source_provider
            ? html`${named(all, row.source_provider)}<br><code>${row.source_entity}</code>` : "—"}
          <td>${row.command ? named(orders, row.command) : "—"}
          <td><code>${Object.keys(row.value).length ? JSON.stringify(row.value) : "—"}</code>
          <td><button type=button data-remove="${row.id}">${t`Delete`}</button>
        </tr>`)}</tbody>
      </table>` : html.async`<p>${t`No virtual entities yet.`}</p>`}
    </section>
    <section class=u2-card>
      <div class=-head>${t`From a device template`}</div>
      <form data-apply>
        <table class="u2-table -Fields -Flex">
          <tr><th><label for="${id("template")}">${t`Template`}</label></th>
            <td><select id="${id("template")}" name=template required>
              ${Object.entries(templates).map(([name, template]) => html`<option value="${name}"
                title="${template.description}">${template.title}</option>`)}
            </select></td></tr>
          <tr><th><label for="${id("source")}">${t`Device provider`}</label></th>
            <td><select id="${id("source")}" name=source required>${options(others)}</select></td></tr>
          <tr><th><label for="${id("device")}">${t`Device name`}</label></th>
            <td><input id="${id("device")}" name=device required pattern="[a-z0-9_]+" placeholder="handy"></td></tr>
          <tr><th><label for="${id("target")}">${t`Virtual provider`}</label></th>
            <td><select id="${id("target")}" name=provider required>${options(own)}</select></td></tr>
        </table>
        <button type=submit>${t`Create entities`}</button>
      </form>
    </section>
    <section class=u2-card>
      <div class=-head>${t`Add virtual entity`}</div>
      <form data-virtual>
        <table class="u2-table -Fields -Flex">
          <tr><th><label for="${id("provider")}">${t`Virtual provider`}</label></th>
            <td><select id="${id("provider")}" name=provider required>${options(own)}</select></td></tr>
          <tr><th><label for="${id("name")}">${t`Name`}</label></th>
            <td><input id="${id("name")}" name=name required maxlength=191></td></tr>
          <tr><th><label for="${id("source_provider")}">${t`Reads from provider`}</label></th>
            <td><select id="${id("source_provider")}" name=source_provider>
              <option value=0>—</option>${options(others)}
            </select></td></tr>
          <tr><th><label for="${id("source_entity")}">${t`Reads entity`}</label></th>
            <td><input id="${id("source_entity")}" name=source_entity maxlength=191></td></tr>
          <tr><th><label for="${id("command")}">${t`Sets through command`}</label></th>
            <td><select id="${id("command")}" name=command>
              <option value=0>—</option>${options(orders)}
            </select></td></tr>
          <tr><th><label for="${id("value")}">${t`Value schema (JSON)`}</label></th>
            <td><textarea id="${id("value")}" name=value rows=2
              placeholder='{"type":"integer","minimum":0}'></textarea></td></tr>
        </table>
        <button type=submit>${t`Add virtual entity`}</button>
      </form>
    </section>`;
}
