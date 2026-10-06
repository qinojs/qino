import { html, toInput } from "@qino/qino";
import { adapters as linked, providers as stored, redact } from "@qino/qino/home";

import { dialog, field } from "./render.ts";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Provider } from "@qino/qino/home";

type Schema = {
  properties?: Record<string, Schema>; title?: string; writeOnly?: boolean; readOnly?: boolean;
  "x-html"?: Record<string, unknown>;
};

function fields(schema: Schema, path: string[] = []): { path: string[]; schema: Schema }[] {
  if (!schema.properties) return path.length ? [{ path, schema }] : [];
  return Object.entries(schema.properties).flatMap(([key, child]) => fields({
    ...child, readOnly: schema.readOnly || child.readOnly, writeOnly: schema.writeOnly || child.writeOnly,
  }, [...path, key]));
}

/** The providers, each editable in a dialog, plus a creation dialog per linked adapter. */
export async function settings(node: Node): Promise<HtmlString> {
  const app = node.app, t = app.t;
  const adapters = linked(app) as { name: string; schema?: Schema }[];
  const providers = (await stored(app)).map((row) => redact(app, row));
  const form = (adapter: { name: string; schema?: Schema }, row?: Provider) => {
    const config = fields(adapter.schema ?? {});
    const prefix = `${node.id}-${adapter.name}-${row?.id ?? "new"}`;
    const hidden = config.map(({ schema }) => schema["x-html"]?.type === "hidden");
    const rows = config.map(({ path, schema }) => {
      let value: unknown = row?.config;
      for (const key of path) value = (value as Record<string, unknown> | undefined)?.[key];
      const id = `${prefix}-config.${path.join(".")}`;
      const attrs = { ...schema["x-html"], id, autocomplete: schema.writeOnly ? "new-password" : "off" };
      const input = html.raw(toInput({ ...schema, "x-html": attrs }, {
        name: "config." + path.join("."), value: schema.writeOnly ? "" : value, disabled: schema.readOnly,
      }));
      if (schema["x-html"]?.type === "hidden") return input;
      return field(id, schema.title ?? path.join("."), input);
    });
    return html.async`<form data-provider-config data-adapter="${adapter.name}" data-provider="${row?.id ?? ""}">
        ${rows.filter((_, index) => hidden[index])}
        <table class="u2-table -Fields -Flex">
          ${field(`${prefix}-name`, t`Name`,
            html`<input id="${prefix}-name" name=name value="${row?.name ?? ""}" required maxlength=191>`)}
          ${rows.filter((_, index) => !hidden[index])}
          ${field(`${prefix}-enabled`, t`Enabled`, html`<input id="${prefix}-enabled" name=enabled type=checkbox
            ${!row || row.enabled ? html.raw("checked") : ""}>`)}
        </table>
        ${config.some(({ schema }) => schema.writeOnly)
          ? html.async`<p>${t`Leave secret fields empty to keep saved values.`}</p>` : ""}
        <button type=submit>${row ? t`Save and reconnect` : t`Add provider`}</button>
      </form>`;
  };
  return html.async`${providers.length ? html.async`<table class=u2-table>
      <thead><tr>
        <th>${t`ID`}
        <th>${t`Name`}
        <th>${t`Adapter`}
        <th>${t`Enabled`}
        <th>
      <tbody>${providers.map((row) => {
        const adapter = adapters.find((adapter) => adapter.name === row.adapter);
        return html.async`<tr>
          <td>${row.id}</td>
          <td>${row.name}</td>
          <td>${adapter?.schema?.title ?? row.adapter}</td>
          <td><input type=checkbox data-provider-enabled data-provider="${row.id}"
            aria-label="${t`Enabled`} ${row.name}" ${row.enabled ? html.raw("checked") : ""}></td>
          <td>${adapter ? dialog(t`Edit`, row.name, form(adapter, row)) : t`The adapter is not linked.`}</td>
        </tr>`;
      })}</tbody>
    </table>` : html.async`<p>${t`No providers are configured.`}</p>`}
    <p>${adapters.map((adapter) => {
      const title = html.async`${t`Add provider`} · ${adapter.schema?.title ?? adapter.name}`;
      return dialog(title, title, form(adapter));
    })}</p>`;
}
