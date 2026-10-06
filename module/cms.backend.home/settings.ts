import { html, toInput } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { adapters as linked, commands, datapoints, entities, providers as stored, redact } from "@qino/qino/home";

import { dialog, field, link } from "./render.ts";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Provider } from "@qino/qino/home";

type Schema = {
  properties?: Record<string, Schema>; title?: string; writeOnly?: boolean; readOnly?: boolean;
  "x-html"?: Record<string, unknown>;
};

type Linked = { name: string; schema?: Schema };

function fields(schema: Schema, path: string[] = []): { path: string[]; schema: Schema }[] {
  if (!schema.properties) return path.length ? [{ path, schema }] : [];
  return Object.entries(schema.properties).flatMap(([key, child]) => fields({
    ...child, readOnly: schema.readOnly || child.readOnly, writeOnly: schema.writeOnly || child.writeOnly,
  }, [...path, key]));
}

/** A provider's settings form: its name, its adapter's configuration fields and whether it is enabled. */
function form(node: Node, adapter: Linked, row?: Provider): Promise<HtmlString> {
  const t = node.app.t;
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
}

/** A creation dialog per linked adapter, for the head of the providers' card. */
export function additions(node: Node): Promise<HtmlString> {
  const t = node.app.t;
  return html.async`${(linked(node.app) as Linked[]).map((adapter) => {
    const title = html.async`${t`Add provider`} · ${adapter.schema?.title ?? adapter.name}`;
    return dialog(title, title, form(node, adapter));
  })}`;
}

/** The providers, each leading to its page and editable in a dialog. */
export async function settings(node: Node): Promise<HtmlString> {
  const app = node.app, t = app.t;
  const adapters = linked(app) as Linked[];
  const [providers, points, orders] = await Promise.all([
    stored(app).then((rows) => rows.map((row) => redact(app, row))), datapoints(app), commands(app),
  ]);
  // Live entities per enabled provider, or why it has none.
  const live = new Map(await Promise.all(providers.filter((row) => row.enabled).map(async (row) =>
    [row.id, await entities(app, row.id).then((list) => list.length, (error: Error) => error.message)] as const)));

  return html.async`${providers.length ? html.async`<table class=u2-table>
      <thead><tr>
        <th>${t`ID`}
        <th>${t`Name`}
        <th>${t`Adapter`}
        <th>${t`Live entities`}
        <th>${t`Datapoints`}
        <th>${t`Commands`}
        <th>${t`Enabled`}
        <th>
      <tbody>${providers.map((row) => {
        const adapter = adapters.find((adapter) => adapter.name === row.adapter), state = live.get(row.id);
        const count = (list: { provider: number }[]) => list.filter((item) => item.provider === row.id).length;
        return html.async`<tr u2-href>
          <td>${row.id}</td>
          <td><a href="${link(node, { provider: row.id })}" style="color:${backend.uniqueColor(row.name)}">
            ${row.name}</a></td>
          <td>${adapter?.schema?.title ?? row.adapter}</td>
          <td>${typeof state === "number" ? state : state ? html`<span role=alert>${state}</span>` : "—"}</td>
          <td>${count(points)}</td>
          <td>${count(orders)}</td>
          <td><input type=checkbox data-provider-enabled data-provider="${row.id}"
            aria-label="${t`Enabled`} ${row.name}" ${row.enabled ? html.raw("checked") : ""}></td>
          <td>${adapter ? dialog(t`Edit`, row.name, form(node, adapter, row)) : t`The adapter is not linked.`}</td>
        </tr>`;
      })}</tbody>
    </table>` : html.async`<p>${t`No providers are configured.`}</p>`}`;
}
