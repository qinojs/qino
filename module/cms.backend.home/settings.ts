import { html, toInput } from "@qino/qino";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Provider } from "@qino/qino/home";

type Schema = { properties?: Record<string, Schema>; title?: string; writeOnly?: boolean; readOnly?: boolean; "x-html"?: Record<string, unknown> };

function fields(schema: Schema, path: string[] = []): { path: string[]; schema: Schema }[] {
  return schema.properties
    ? Object.entries(schema.properties).flatMap(([key, child]) => fields({ ...child, readOnly: schema.readOnly || child.readOnly, writeOnly: schema.writeOnly || child.writeOnly }, [...path, key]))
    : path.length ? [{ path, schema }] : [];
}

/** One form per persisted connection, plus creation forms for linked adapters. */
export async function settings(node: Node): Promise<HtmlString> {
  const app = node.app, t = app.t;
  const adapters = await app.api.home.adapters.get() as { name: string; schema?: Schema }[];
  const providers = await app.api.home.providers.get() as Provider[];
  const form = async (adapter: { name: string; schema?: Schema }, row?: Provider) => {
    const all = fields(adapter.schema ?? {});
    const hidden = all.map(({ schema }) => schema["x-html"]?.type === "hidden");
    const rows = all.map(({ path, schema }) => {
      let value: unknown = path.length === 1 && path[0] === "url" ? row?.url : row?.config;
      if (!(path.length === 1 && path[0] === "url")) for (const key of path) value = (value as Record<string, unknown> | undefined)?.[key];
      const name = path.length === 1 && path[0] === "url" ? "url" : "config." + path.join(".");
      const id = `${node.id}-${adapter.name}-${row?.id ?? "new"}-${path.join(".")}`;
      const input = html.raw(toInput({ ...schema, "x-html": { ...schema["x-html"], id, autocomplete: schema.writeOnly ? "new-password" : "off" } }, {
        name, value: schema.writeOnly ? "" : value, disabled: schema.readOnly,
      }));
      if (schema["x-html"]?.type === "hidden") return input;
      return html`<tr>
        <th><label for="${id}">${schema.title ?? path.join(".")}</label></th>
        <td>${input}</td>
      </tr>`;
    });
    return html.async`<form data-provider-config data-adapter="${adapter.name}" data-provider="${row?.id ?? ""}">
        <label>${t`Name`}<input name=name value="${row?.name ?? ""}" required maxlength=191></label>
        ${!all.some((field) => field.path.join(".") === "url") ? html.async`<label>${t`URL`}<input name=url type=url value="${row?.url ?? ""}"></label>` : ""}
        ${rows.filter((_, index) => hidden[index])}
        <table class="u2-table -Fields -Flex">${rows.filter((_, index) => !hidden[index])}</table>
        <label><input name=enabled type=checkbox ${!row || row.enabled ? html.raw("checked") : ""}>${t`Enabled`}</label>
        ${all.some(({ schema }) => schema.writeOnly) ? html.async`<p>${t`Leave secret fields empty to keep saved values.`}</p>` : ""}
        <button type=submit>${row ? t`Save and reconnect` : t`Add provider`}</button>
      </form>`;
  };
  return html.async`<div style="display:contents">
    ${providers.length ? html.async`<section class=u2-card>
      <div class=-head>${t`Providers`}</div>
      <table class=u2-table>
        <thead><tr>
          <th>${t`ID`}
          <th>${t`Name`}
          <th>${t`Adapter`}
          <th>${t`URL`}
          <th>${t`Enabled`}
          <th>${t`Settings`}
        <tbody>${providers.map((row) => {
          const adapter = adapters.find((adapter) => adapter.name === row.adapter);
          return html.async`<tr>
            <td>${row.id}</td>
            <td>${row.name}</td>
            <td>${adapter?.schema?.title ?? row.adapter}</td>
            <td>${row.url || "—"}</td>
            <td><input type=checkbox data-provider-enabled data-provider="${row.id}" aria-label="${t`Enabled`} ${row.name}" ${row.enabled ? html.raw("checked") : ""}></td>
            <td>${adapter ? html.async`<details><summary>${t`Edit`}</summary>${form(adapter, row)}</details>` : html.async`<p>${t`The adapter is not linked.`}</p>`}</td>
          </tr>`;
        })}</tbody>
      </table>
    </section>` : ""}
    ${adapters.map((adapter) => html.async`<section class=u2-card>
      <div class=-head>${t`Add provider`} · ${adapter.schema?.title ?? adapter.name}</div>
      ${form(adapter)}
    </section>`)}
  </div>`;
}
