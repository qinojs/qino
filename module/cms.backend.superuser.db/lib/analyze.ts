// deno-lint-ignore-file no-explicit-any

export type FieldConflict = {
  table: string;
  field: string;
  prop: string;
  values: { module: string; value: unknown }[];
};

export function sortTableNames(names: string[]): string[] {
  return [...names].sort((a, b) =>
    Number(a.startsWith("_")) - Number(b.startsWith("_")) || a.localeCompare(b)
  );
}

type FieldVisitor = (modName: string, table: string, field: string, fieldSchema: Record<string, unknown>) => void;

function iterateSchemaFields(modules: Record<string, any>, visit: FieldVisitor): void {
  for (const [modName, mod] of Object.entries(modules)) {
    const tables = mod.plugin?.dbSchema?.properties;
    if (!tables) continue;
    for (const [table, tableSchema] of Object.entries(tables as Record<string, any>)) {
      const fields = tableSchema?.additionalProperties?.properties ?? {};
      for (const [field, fieldSchema] of Object.entries(fields as Record<string, any>))
        visit(modName, table, field, fieldSchema);
    }
  }
}

export function collectConflicts(modules: Record<string, any>): FieldConflict[] {
  const seen: Record<string, { module: string; value: unknown }[]> = {};

  iterateSchemaFields(modules, (modName, table, field, fieldSchema) => {
    for (const [prop, value] of Object.entries(fieldSchema)) {
      const key = `${table}\0${field}\0${prop}`;
      (seen[key] ??= []).push({ module: modName, value });
    }
  });

  return Object.entries(seen).flatMap(([key, entries]) => {
    if (entries.length < 2) return [];
    const first = JSON.stringify(entries[0].value);
    if (entries.every(e => JSON.stringify(e.value) === first)) return [];
    const [table, field, prop] = key.split("\0");
    return [{ table, field, prop, values: entries }];
  });
}

export type ModuleTableIndex = Record<string, Record<string, string[]>>;

export function buildModuleTableIndex(modules: Record<string, any>): ModuleTableIndex {
  const index: ModuleTableIndex = {};
  iterateSchemaFields(modules, (modName, table, field) => {
    ((index[modName] ??= {})[table] ??= []).push(field);
  });
  return index;
}

export function fieldOriginsByTable(modules: Record<string, any>, tableName: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  iterateSchemaFields(modules, (modName, table, field) => {
    if (table === tableName) (result[field] ??= []).push(modName);
  });
  return result;
}
