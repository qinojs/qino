import type { App } from "@qino/qino";

export type Schema = { type?: string | string[]; properties?: Record<string, Schema> };

const accepts = (schema: Schema, type: string) => [schema.type ?? []].flat().includes(type);

/** One value as its schema wants it. PHP stored every setting as a string ("10", "1", ""); a
 *  value that does not fit stays as it is, an empty number is no value (the default applies). */
export function coerceSetting(value: unknown, schema: Schema): unknown {
  if (value && typeof value === "object" && !Array.isArray(value) && schema.properties) {
    return coerceObject(value as Record<string, unknown>, schema.properties);
  }
  if (accepts(schema, "string")) return value;
  if (accepts(schema, "boolean") && (typeof value === "string" || typeof value === "number")) {
    const v = String(value).trim().toLowerCase();
    if (["1", "true", "on"].includes(v)) return true;
    if (["0", "false", "off", ""].includes(v)) return false;
  }
  if ((accepts(schema, "integer") || accepts(schema, "number")) && typeof value === "string") {
    if (!value.trim()) return undefined;
    const n = Number(value);
    if (Number.isFinite(n) && (accepts(schema, "number") || Number.isInteger(n))) return n;
  }
  return value;
}

function coerceObject(values: Record<string, unknown>, properties: Record<string, Schema>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    const v = properties[key] ? coerceSetting(value, properties[key]) : value;
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/** Page settings in the types their module's schema declares — after the modules got their
 *  qino names, so the schema is the one that reads them. */
export async function coerceSettings(app: App): Promise<number> {
  const rows = await app.db.query`SELECT id, module, settings FROM page WHERE settings IS NOT NULL AND settings <> '' AND settings <> '{}'`;
  let changed = 0;
  for (const row of rows) {
    const schema = app.modules.get(String(row.module ?? ""))?.plugin.cms?.node?.settingsSchema as Schema | undefined;
    if (!schema?.properties) continue;
    let values: unknown;
    try { values = JSON.parse(String(row.settings)); } catch { continue; }
    if (!values || typeof values !== "object" || Array.isArray(values)) continue;
    const json = JSON.stringify(coerceObject(values as Record<string, unknown>, schema.properties));
    if (json === JSON.stringify(values)) continue;
    await app.db.table("page").update(row.id, { settings: json });
    changed++;
  }
  return changed;
}
