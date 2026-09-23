import { fromFileUrl, resolve, toFileUrl } from "@std/path";
import { fs } from "@qino/qino";

/** Table columns declared by all local qino stores (inline `dbSchema` and dbschema.json, via the
 *  plugins), so preparation sees the real schema. */
export async function schemaColumns(qino: string): Promise<Record<string, Record<string, string>>> {
  const tables: Record<string, Record<string, string>> = {};
  qino = resolve(qino);
  for (const storeFile of ["module/store.json", "shp3/store.json", "cms-legacy/store.json"]) {
    const storePath = qino + "/" + storeFile;
    const store = JSON.parse(await fs.text(storePath));
    const base = fromFileUrl(new URL("./", toFileUrl(storePath)));
    for (const name of Object.keys(store.modules ?? {})) {
      const plugin = await import(toFileUrl(base + name + "/plugin.ts").href);
      const schema = plugin.dbSchema?.properties as Record<string, {
        additionalProperties?: { properties?: Record<string, { type?: unknown }> };
      }> | undefined;
      for (const [table, spec] of Object.entries(schema ?? {})) {
        const columns = tables[table] ??= {};
        for (const [column, data] of Object.entries(spec.additionalProperties?.properties ?? {}))
          columns[column] = String(data.type ?? "");
      }
    }
  }
  return tables;
}

if (import.meta.main) console.log(JSON.stringify(await schemaColumns(Deno.args[0])));
