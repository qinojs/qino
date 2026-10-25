// The query of a table node: its fields are columns of the table or, along references, of the rows
// they point to (`path`: `organizer_id.company`). What a user narrows (search, order, filters) is
// kept per user; `where` and fixed fields bound what the list may ever reach.
import { getCtx, sql, sqlSearch } from "@qino/qino";

import type { App, Ctx, Row, Sql } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

/** A column as the database describes it. */
export type Column = { name: string; type: string; length: string; nullable: boolean; key: boolean; primary: boolean; autoIncrement: boolean };

/** What one user narrowed a list to. */
export type State = { search?: string; order?: string; filters?: Record<string, string> };

const NAME = "cms.cont.dbtable";
const json = (v: unknown) => { try { return JSON.parse(String(v || "null")); } catch { return null; } };
const on = (v: unknown) => v === true || v === 1 || v === "1";

export async function columns(app: App, table: string): Promise<Column[]> {
  const rows = await app.db.columns(table).catch(() => []);
  return rows.map((r: Row) => {
    const [, type = "", length = ""] = String(r.Type).match(/^(\w+)(?:\(([^)]*)\))?/) ?? [];
    return {
      name: String(r.Field), type: type.toLowerCase(), length, nullable: r.Null === "YES", key: !!r.Key,
      primary: r.Key === "PRI", autoIncrement: String(r.Extra ?? "").includes("auto_increment"),
    };
  });
}

/** The table a reference column points to: as the schema says, else `<name>_id` → `<name>`. */
export function parentOf(app: App, table: string, column: string, tables: string[]): string | undefined {
  let declared: unknown;
  try { declared = app.db.table(table).field(column)?.schema?.["x-qg-parent"]; } catch { /* not in the schema */ }
  if (declared) return String(declared);
  const guess = column.replace(/_id$/, "");
  return guess !== column && tables.includes(guess) ? guess : undefined;
}

/** The type a column shows as while nobody chose one. */
export function typeOf(column: Column): string {
  if (column.type === "tinyint" && column.length === "1") return "checkbox";
  if (["int", "bigint", "smallint", "mediumint", "float", "double"].includes(column.type)) return "number";
  if (["text", "mediumtext", "longtext"].includes(column.type)) return "textarea";
  if (["decimal", "date", "datetime", "time", "timestamp"].includes(column.type)) return column.type === "timestamp" ? "datetime" : column.type;
  return "text";
}

/** One field of the list. */
export class Field {
  name = "";
  path: string[] = [];
  table = "";
  /** The alias of its table in the query. */
  from = "";
  column!: Column;
  /** Of the base table: only those are written. */
  own = false;
  set: Record<string, unknown> = {};

  get type(): string { return String(this.set.type || typeOf(this.column)); }
  is(flag: string): boolean { return on(this.set[flag]); }
  str(key: string): string { return String(this.set[key] ?? ""); }
  get sql(): Sql { return sql`${sql.id(this.from)}.${sql.id(this.column.name)}`; }
}

/** A user's narrowing of this list, in its context settings. */
export async function state(ctx: Ctx, node: Node): Promise<State> {
  return json(await ctx.settings[NAME].nodes[node.id]) ?? {};
}
export async function setState(ctx: Ctx, node: Node, change: (s: State) => void): Promise<void> {
  const s = await state(ctx, node);
  change(s);
  await ctx.settings[NAME].nodes[node.id](JSON.stringify(s));
}

/** What a default or fixed value stands for: `{user}` the user, `{id}` the page's `?id=`. */
export function placeholder(value: string, id: unknown): unknown {
  return value === "{user}" ? getCtx().userId : value === "{id}" ? String(id ?? "") : value;
}

export class Query {
  table = "";
  primary?: Column;
  fields = new Map<string, Field>();
  settings: Record<string, unknown> = {};
  #from: Sql[] = [];
  #scope: Sql[] = [];
  #narrow: Sql[] = [];
  #order: Sql[] = [];
  #base = "";
  /** The field the list is sorted by first, and how. */
  sortedBy?: [string, "ASC" | "DESC"];

  /** The query of `node`, narrowed by `user` when given. `id` is the page's `?id=`. */
  static async of(node: Node, { user, id }: { user?: State; id?: unknown } = {}): Promise<Query | undefined> {
    const q = new Query();
    q.settings = json(node.vs.settings) ?? {};
    q.table = String(q.settings.table ?? "");
    const tables = await node.db.listTables();
    if (!q.table || !tables.includes(q.table)) return;
    await q.#build(node.app, tables, id);
    if (user) q.#narrowBy(user);
    return q;
  }

  async #build(app: App, tables: string[], id: unknown) {
    const own = await columns(app, this.table);
    this.primary = own.find((c) => c.primary);
    // tables go by their name, a second one of the same as f_<n>: `where` names them so
    const taken = new Set<string>();
    const aliasOf = (table: string) => {
      let alias = table;
      for (let i = 1; taken.has(alias); i++) alias = `f_${i}`;
      taken.add(alias);
      return alias;
    };
    this.#base = aliasOf(this.table);
    this.#from.push(sql`${sql.id(this.table)} AS ${sql.id(this.#base)}`);
    // one join per reference path, shared by the fields along it
    type Join = { table: string; alias: string; columns: Column[] };
    const joins = new Map<string, Join>([["", { table: this.table, alias: this.#base, columns: own }]]);
    const join = async (path: string[]): Promise<Join | undefined> => {
      const key = path.join(".");
      if (joins.has(key)) return joins.get(key);
      const up = await join(path.slice(0, -1));
      const column = up?.columns.find((c) => c.name === path.at(-1));
      const parent = up && column ? parentOf(app, up.table, column.name, tables) : undefined;
      if (!up || !parent) return;
      const columns_ = await columns(app, parent), alias = aliasOf(parent);
      const pk = columns_.find((c) => c.primary)?.name ?? "id";
      this.#from.push(sql`LEFT JOIN ${sql.id(parent)} AS ${sql.id(alias)} ON ${sql.id(up.alias)}.${sql.id(column!.name)} = ${sql.id(alias)}.${sql.id(pk)}`);
      const j: Join = { table: parent, alias, columns: columns_ };
      joins.set(key, j);
      return j;
    };

    const fields = (this.settings.fields ?? {}) as Record<string, Record<string, unknown>>;
    for (const name of this.#sorted(Object.keys(fields))) {
      const set = fields[name] ?? {};
      const path = String(set.path || name).split(".");
      const from = await join(path.slice(0, -1));
      const column = from?.columns.find((c) => c.name === path.at(-1));
      if (!from || !column) continue; // a column gone since
      this.fields.set(name, Object.assign(new Field(), { name, path, table: from.table, from: from.alias, column, own: path.length === 1, set }));
    }

    for (const f of this.fields.values()) {
      if (f.is("fix")) this.#scope.push(sql`${f.sql} = ${placeholder(f.str("default"), id)}`);
    }
    // the node's own condition, written by whoever configures the list: trusted SQL
    const where = String(this.settings.where ?? "").trim();
    if (where) this.#scope.push(sql.raw(`(${where})`));
  }

  #sorted(names: string[]) {
    const order = String(this.settings.field_order ?? "").split(",").filter((n) => names.includes(n));
    return [...order, ...names.filter((n) => !order.includes(n))];
  }

  #narrowBy(user: State) {
    for (const [name, value] of Object.entries(user.filters ?? {})) {
      const f = this.fields.get(name);
      if (!f?.is("filter") || value === "") continue;
      this.#narrow.push(f.type === "text" || f.type === "textarea" ? sql`${f.sql} LIKE ${"%" + value + "%"}` : sql`${f.sql} = ${value}`);
    }
    const search = user.search ?? String(this.settings.search ?? "");
    const searched = [...this.fields.values()].filter((f) => f.is("search")).map((f) => `${f.from}.${f.column.name}`);
    if (search && searched.length) this.#narrow.push(sqlSearch(search, searched).where);
    // the user's choice first, then the configured order
    const order = [user.order, String(this.settings.order ?? "")].join(",").split(",").map((o) => o.trim().split(/\s+/));
    const seen = new Set<string>();
    for (const [name, dir] of order) {
      const f = this.fields.get(name);
      if (!f || seen.has(name)) continue;
      seen.add(name);
      const d = dir?.toUpperCase() === "DESC" ? "DESC" : "ASC";
      this.sortedBy ??= [name, d];
      this.#order.push(sql`${f.sql} ${sql.raw(d)}`);
    }
  }

  /** The columns of the list in their order, those with `flag` set if given; fixed fields never show. */
  shown(flag?: string): Field[] { return [...this.fields.values()].filter((f) => !f.is("fix") && (!flag || f.is(flag))); }

  #where(extra: Sql[] = [], narrow = true) {
    const all = [...this.#scope, ...narrow ? this.#narrow : [], ...extra];
    return all.length ? sql`WHERE ${sql.join(all, " AND ")}` : sql``;
  }

  #key(): Sql { return this.primary ? sql`${sql.id(this.#base)}.${sql.id(this.primary.name)}` : sql`NULL`; }

  /** The SELECT, rendered as a whole: rows of a page (`offset`, `limit`), or the row with `id`. */
  select({ limit, offset = 0, id }: { limit?: number; offset?: number; id?: unknown } = {}): Sql {
    const list = sql.join([sql`${this.#key()} AS ${sql.id("__id")}`, ...[...this.fields.values()].map((f) => sql`${f.sql} AS ${sql.id(f.name)}`)]);
    const byId = id !== undefined && this.primary ? [sql`${this.#key()} = ${id}`] : [];
    const order = this.#order.length ? sql`ORDER BY ${sql.join(this.#order)}` : sql``;
    const page = limit ? sql`LIMIT ${sql.raw(String(Math.max(0, Math.floor(limit))))} OFFSET ${sql.raw(String(Math.max(0, Math.floor(offset))))}` : sql``;
    return sql`SELECT ${list} FROM ${sql.join(this.#from, " ")} ${this.#where(byId)} ${order} ${page}`;
  }

  rows(db: App["db"], opts: { limit?: number; offset?: number; id?: unknown } = {}): Promise<Row[]> {
    return db.query`${this.select(opts)}`;
  }

  /** The row with this key — only while the list reaches it. */
  async row(db: App["db"], id: unknown): Promise<Row | undefined> {
    return this.primary ? (await this.rows(db, { id }))[0] : undefined;
  }

  async count(db: App["db"]): Promise<number> {
    return Number(await db.one`SELECT COUNT(*) FROM ${sql.join(this.#from, " ")} ${this.#where()}`);
  }

  /** The values a field takes within the list's bounds, up to `max`; undefined when it takes more. */
  async values(db: App["db"], f: Field, max: number): Promise<unknown[] | undefined> {
    const values = await db.col`SELECT DISTINCT ${f.sql} AS v FROM ${sql.join(this.#from, " ")} ${this.#where([], false)} ORDER BY v LIMIT ${sql.raw(String(max + 1))}`;
    return values.length > max ? undefined : values;
  }
}
