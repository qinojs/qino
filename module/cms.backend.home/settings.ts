import { $item, ApiError, html, toInput } from "@qino/qino";
import { validate } from "@qino/item/tools/schema/validator.js";

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

type Schema = { properties?: Record<string, Schema>; title?: string; writeOnly?: boolean; readOnly?: boolean; "x-html"?: Record<string, unknown> };

function fields(schema: Schema, path: string[] = []): { path: string[]; schema: Schema }[] {
  return schema.properties
    ? Object.entries(schema.properties).flatMap(([key, child]) => fields(child, [...path, key]))
    : path.length ? [{ path, schema }] : [];
}

export async function settings(node: Node): Promise<HtmlString> {
  const app = node.app, t = app.t;
  const modules = app.modules.linked().filter((mod) => mod.plugin.homeProvider && mod.plugin.settingsSchema);
  return html.join(await Promise.all(modules.map(async (mod) => {
    const schema = mod.plugin.settingsSchema as Schema;
    const all = fields(schema);
    const rows = await Promise.all(all.map(async ({ path, schema }) => {
      const item = app.settings[$item].sub([mod.name, ...path]);
      const value = schema.writeOnly ? "" : await item.proxy;
      const id = `${node.id}-${mod.name}-${path.join(".")}`;
      const input = toInput({ ...schema, "x-html": { ...schema["x-html"], id, autocomplete: schema.writeOnly ? "new-password" : "off" } }, {
        name: path.join("."), value, disabled: schema.readOnly,
      });
      return html`<tr>
        <th><label for="${id}">${schema.title ?? path.join(".")}</label>
        <td>${html.raw(input)}
      </tr>`;
    }));
    return html.async`<div class=u2-card>
      <div class=-head>${schema.title ?? mod.plugin.homeProvider.name}</div>
      <form data-config data-module="${mod.name}">
        <table class="u2-table -Fields -Flex">${rows}</table>
        ${all.some(({ schema }) => schema.writeOnly) ? html.async`<p>${t`Leave secret fields empty to keep saved values.`}</p>` : ""}
        <button type=submit>${t`Save and reconnect`}</button>
      </form>
    </div>`;
  })));
}

export async function saveSettings(app: App, input: unknown): Promise<void> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ApiError(400, "Invalid provider configuration");
  const { module, values } = input as { module: unknown; values: unknown };
  const mod = typeof module === "string" ? app.modules.linked(module) : undefined;
  if (!mod?.plugin.homeProvider || !mod.plugin.settingsSchema) throw new ApiError(400, "Provider configuration is not available");
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new ApiError(400, "Invalid provider settings");
  const known = new Map(fields(mod.plugin.settingsSchema as Schema).map((field) => [field.path.join("."), field]));
  const writes = Object.entries(values).flatMap(([key, value]) => {
    const field = known.get(key);
    if (!field || field.schema.readOnly) throw new ApiError(400, `Unknown or read-only setting: ${key}`);
    if (field.schema.writeOnly && value === "") return [];
    if (validate(field.schema, value).length) throw new ApiError(400, `Invalid setting: ${key}`);
    return [{ path: field.path, value }];
  });
  const dependent = app.modules.linked().find((other) => other !== mod && other.dependencies.includes(mod.name));
  if (dependent) throw new ApiError(409, `Cannot reconnect while ${dependent.name} depends on ${mod.name}`);
  const previous = await Promise.all(writes.map(async ({ path }) => ({ path, value: await app.settings[$item].sub([mod.name, ...path]).proxy })));
  for (const { path, value } of writes) await app.settings[$item].sub([mod.name, ...path]).set(value);
  app.modules.unlink(mod.name);
  try { await app.modules.link(mod.name); }
  catch (error) {
    for (const { path, value } of previous) await app.settings[$item].sub([mod.name, ...path]).set(value);
    await app.modules.link(mod.name);
    throw error;
  }
}
