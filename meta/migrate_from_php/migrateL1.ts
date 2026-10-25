// deno-lint-ignore-file no-explicit-any
import { renamedColumns } from "./renameColumns.ts";

import type { App } from "@qino/qino";

const json = (v: unknown) => { try { return JSON.parse(String(v || "null")); } catch { return null; } };
const on = (v: unknown) => v === true || v === 1 || v === "1";
/** Shown: by its own `use` only, as PHP's l1ContQuery read it. */
const used = (vs: any): boolean => vs?.use === true;

/** The table a reference column points to: as the schema says, else `<name>_id` → `<name>`. */
function parentOf(app: App, tables: string[], table: string, field: string): string | undefined {
  let declared: unknown;
  try { declared = app.db.table(table).field(field)?.schema?.["x-qg-parent"]; } catch { /* not in the schema */ }
  if (declared) return String(declared);
  const guess = field.replace(/_id$/, "");
  return guess !== field && tables.includes(guess) ? guess : undefined;
}

/** PHP's handlers as cms.cont.dbtable's types. */
const TYPES: Record<string, string> = {
  default: "text", int: "number", text: "textarea", bool: "checkbox", date: "date", datetime: "datetime", timestamp: "datetime",
  timefromint: "datetime", time: "time", decimal: "decimal", html: "html", select: "select", fkselect: "reference",
  qgimage: "image", qgfile: "file",
};
const PLACEHOLDERS: Record<string, string> = { "#usr#": "{user}", "#get_id#": "{id}" };

/** `a=1&b` options of a PHP field. */
const options = (s: string) => Object.fromEntries(s.split("&").filter(Boolean).map((o) => {
  const [k, v] = o.split("=", 2);
  return [k, v ?? ""];
}));

/** PHP's suggestion for a field nobody configured, as l1ContQuery made it. */
function suggest(type: string, length: string, key: boolean, primary: boolean, own: boolean, name: string) {
  const handler = type === "tinyint" && length === "1" ? "bool" : ["varchar", "tinyint"].includes(type) ? "default" : type === "float" ? "int" : type;
  return {
    handler, editable: !primary && own && !["log_id", "log_id_ch"].includes(name), showList: handler !== "text", showDetail: true,
    searchable: key, search: true, orderable: key,
  };
}

/** One field of PHP's settings as cms.cont.dbtable keeps it. Editable means in the list there;
 *  PHP's detail view is gone, so without a detail page its editable fields move to the list. */
function field(raw: any, path: string[], name: string, detailPage: boolean): Record<string, unknown> {
  const o = options(String(raw.options ?? ""));
  const handler = String(raw.handler || "default").toLowerCase();
  const out: Record<string, unknown> = {
    ...path.join(".") !== name ? { path: path.join(".") } : {},
    type: TYPES[handler] ?? "text",
    list: on(raw.showList), edit: on(raw.editable) && (on(raw.listEdit) || (!detailPage && on(raw.showDetail))),
    insert: on(raw.insertable), search: on(raw.search) && on(raw.searchable), sort: on(raw.orderable), fix: on(raw.fix),
  };
  const def = String(raw.defaultValue ?? "");
  if (def) out.default = PLACEHOLDERS[def] ?? def;
  if (raw.listWidth) out.width = String(raw.listWidth);
  if (raw.link) out.link = String(raw.link);
  if (handler === "select") out.choices = Object.entries(o).map(([k, v]) => v ? `${k}=${v}` : k).join("\n");
  if (handler === "fkselect" && o.select) out.ref_label = o.select;
  if (handler === "fkselect" && o.where) out.ref_where = o.where;
  if (handler === "qgimage" && (o.width || o.height)) out.size = `${o.width || 30}x${o.height || 20}`;
  if (handler === "text" && o.cut) out.cut = Number(o.cut);
  return out;
}

/** cms.cont.l1.table1 becomes cms.cont.dbtable: the query's fields — under the names PHP gave them,
 *  columns renamed since (usr.firstname → given_name …) followed — with their settings, labels and
 *  order. A cms.cont.l1.table1.filter turns into the filters of its list and goes. */
export async function migrateL1(app: App): Promise<void> {
  const tables = await app.db.listTables();
  const renamed = (table: string, f: string) => renamedColumns.find(([t, old]) => t === table && old === f)?.[2];
  const columnsOf = async (table: string) => new Map((await app.db.columns(table).catch(() => [])).map((c: any) => [String(c.Field), c]));

  // the filters name the fields of their list
  const filters = new Map<number, { id: number; fields: Record<string, any> }>();
  for (const node of await app.db.query`SELECT id, settings FROM page WHERE module = 'cms.cont.l1.table1.filter'`) {
    const s = json(node.settings) ?? {};
    filters.set(Number(s["list-content-id"]), { id: Number(node.id), fields: s.fields ?? {} });
  }

  let lists = 0;
  for (const node of await app.db.query`SELECT id, settings FROM page WHERE module = 'cms.cont.l1.table1'`) {
    const old = json(node.settings) ?? {};
    const table = String(old.table ?? "");
    // the fields shown, in the order PHP's query selected them: name then and now, column path, column
    const shown: { old: string; now: string; path: string[]; own: boolean; col: any }[] = [];
    const walk = async (t: string, def: any, prefix: string[]) => {
      if (!def?.sub || typeof def.sub !== "object") return;
      const cols = await columnsOf(t);
      for (const [f, vs] of Object.entries(def.sub) as [string, any][]) {
        if (!used(vs)) continue;
        const current = renamed(t, f) && !(renamed(t, f)! in def.sub) ? renamed(t, f)! : f;
        shown.push({ old: f, now: current, path: [...prefix, current], own: !prefix.length, col: cols.get(current) });
        const parent = vs.sub && Object.values(vs.sub).some(used) ? parentOf(app, tables, t, current) : undefined;
        if (parent) await walk(parent, vs, [...prefix, current]);
      }
    };
    // the key comes first, whether the query names it or not: PHP's query always had it
    const def = json(old.query) ?? {};
    const key = [...(await columnsOf(table)).values()].find((c) => c.Key === "PRI");
    if (key) {
      const { [key.Field]: k, ...rest } = def.sub ?? {};
      def.sub = { [key.Field]: { ...k, use: true }, ...rest };
    }
    if (table) await walk(table, def, []);
    // a name taken already got s_<n>, as the list named them
    const name = (names: string[]) => {
      const taken = new Set<string>();
      let n = 1;
      return names.map((f) => { const alias = taken.has(f) ? `s_${n++}` : f; taken.add(alias); return alias; });
    };
    const [before, now] = [name(shown.map((s) => s.old)), name(shown.map((s) => s.now))];
    const rename = new Map(before.map((a, i) => [a, now[i]] as const));

    const filter = filters.get(Number(node.id));
    const fields: Record<string, unknown> = {};
    shown.forEach((s, i) => {
      const raw = old[`field_${before[i]}`];
      const col = s.col ?? {};
      const [, type = "", length = ""] = String(col.Type ?? "").match(/^(\w+)(?:\(([^)]*)\))?/) ?? [];
      const set = raw?.handler ? raw : { ...suggest(type.toLowerCase(), length, !!col.Key, col.Key === "PRI", s.own, s.now), ...raw };
      const f = fields[now[i]] = field(set, s.path, now[i], !!old.detailLink);
      // an expression names columns too (`CONCAT(firstname,' ',lastname)`)
      for (const k of ["ref_label", "ref_where"]) {
        if (typeof f[k] === "string") f[k] = renamedColumns.reduce((e, [, o, c]) => e.replace(new RegExp(`\\b${o}\\b`, "g"), c), f[k] as string);
      }
      if (filter?.fields[before[i]] && filter.fields[before[i]].disable !== "1") f.filter = true;
    });
    const sort = (json(old.fieldSort) ?? []) as string[];
    // PHP: the field ordered last weighs most
    const orders = Object.entries((json(old.orders) ?? {}) as Record<string, string>).reverse()
      .filter(([a]) => rename.has(a)).map(([a, d]) => d === "DESC" ? `${rename.get(a)} DESC` : rename.get(a));
    const settings: Record<string, unknown> = {
      table, where: String(old.addWhere ?? ""), limit: Number(old.limit) || 20, order: orders.join(", "),
      search: String(old.searchValue ?? ""), search_reset: on(old["clean search on reload"]),
      delete: on(old.deletable), copy: on(old.copyable), export: on(old["export button"]), detail_page: String(old.detailLink ?? ""),
      field_order: [...sort.filter((a) => rename.has(a)).map((a) => rename.get(a)), ...now.filter((n) => !sort.some((a) => rename.get(a) === n))].join(","),
      fields,
    };
    for (const [a, n] of rename) await app.db.exec`UPDATE page_text SET name = ${`${n}_title`} WHERE page_id = ${node.id} AND name = ${`field_${a}`}`;
    await app.db.exec`UPDATE page SET module = 'cms.cont.dbtable', settings = ${JSON.stringify(settings)} WHERE id = ${node.id}`;
    lists++;
  }
  // a filter lives in its list now
  for (const { id } of filters.values()) {
    await app.db.exec`DELETE FROM page_text WHERE page_id = ${id}`;
    await app.db.exec`DELETE FROM page WHERE id = ${id}`;
  }
  if (lists) console.log(`[migrate_from_php] cms.cont.l1.table1: ${lists} lists are cms.cont.dbtable now`);
}
