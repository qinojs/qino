// How a field shows, how it is edited and what an edit stores, per type. An unknown type acts as
// `text`.
import { hee, sql } from "@qino/qino";

import { parentOf } from "./query.ts";

import type { App } from "@qino/qino";
import type { Field } from "./query.ts";

type Type = {
  read(f: Field, v: unknown, app: App): string | Promise<string>;
  edit(f: Field, v: unknown, app: App): string | Promise<string>;
  /** The value to store; undefined stores nothing. */
  toDb?(f: Field, v: string): unknown;
};

const str = (v: unknown) => v == null ? "" : String(v);
const pad = (n: number) => String(n).padStart(2, "0");
const showDate = (d: Date) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
const isInt = (f: Field) => ["int", "bigint"].includes(f.column.type);
const empty = (f: Field, v: string) => v === "" && f.column.nullable ? null : v;

const input = (f: Field, v: unknown, attrs = "") =>
  `<input data-f="${hee(f.name)}"${attrs}${f.column.nullable ? "" : " required"} value="${hee(str(v))}">`;

/** `value=Label` per line; a bare value is its own label. */
export const choices = (f: Field): [string, string][] =>
  f.str("choices").split(/\r?\n/).filter((l) => l.trim()).map((l) => {
    const [k, label] = l.split("=", 2);
    return [k.trim(), (label ?? k).trim()];
  });

/** `2026-10-24 09:30:00` (or unix time in an integer column) as a Date. */
const asDate = (f: Field, v: unknown) => isInt(f) ? new Date(Number(v) * 1000) : new Date(str(v).replace(" ", "T"));

const text: Type = { read: (_f, v) => hee(str(v)), edit: (f, v) => input(f, v) };

const types: Record<string, Type> = {
  text,
  textarea: {
    read: (f, v) => {
      const cut = Number(f.str("cut")), t = str(v);
      return hee(cut && t.length > cut ? t.slice(0, cut).replace(/\s+\S*$/, "") + "…" : t);
    },
    edit: (f, v) => `<textarea data-f="${hee(f.name)}">${hee(str(v))}</textarea>`,
  },
  html: {
    read: (_f, v) => `<div class=-html>${str(v)}</div>`,
    edit: (f, v) => `<div class=-html data-f="${hee(f.name)}" contenteditable>${str(v)}</div>`,
  },
  number: {
    read: (_f, v) => hee(str(v)),
    edit: (f, v) => input(f, v, " type=number step=any"),
    toDb: empty,
  },
  decimal: {
    read: (f, v) => decimal(f, v),
    edit: (f, v) => input(f, v == null || v === "" ? "" : Number(v).toFixed(digits(f)), " type=number step=any"),
    toDb: empty,
  },
  checkbox: {
    read: (_f, v) => `<input type=checkbox disabled${Number(v) ? " checked" : ""}>`,
    edit: (f, v) => `<input type=checkbox data-f="${hee(f.name)}"${Number(v) ? " checked" : ""}>`,
    toDb: (_f, v) => Number(v) ? 1 : 0,
  },
  date: {
    read: (_f, v) => !v || str(v).startsWith("0000") ? "" : showDate(new Date(str(v).slice(0, 10) + "T00:00")),
    edit: (f, v) => input(f, str(v).slice(0, 10), " type=date"),
    toDb: empty,
  },
  datetime: {
    read: (f, v) => v == null || v === "" || (isInt(f) && !Number(v)) ? "" : (() => {
      const d = asDate(f, v);
      return `${showDate(d)}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    })(),
    edit: (f, v) => {
      const d = v == null || v === "" || (isInt(f) && !Number(v)) ? undefined : asDate(f, v);
      const local = d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}` : "";
      return input(f, local, " type=datetime-local");
    },
    toDb: (f, v) => !v ? (isInt(f) ? 0 : empty(f, "")) : isInt(f) ? Math.floor(Date.parse(v) / 1000) : v.replace("T", " "),
  },
  time: {
    read: (_f, v) => hee(str(v)),
    edit: (f, v) => input(f, v, " type=time"),
    toDb: empty,
  },
  select: {
    read: (f, v) => hee(choices(f).find(([k]) => k === str(v))?.[1] ?? str(v)),
    edit: (f, v) => `<select data-f="${hee(f.name)}"><option value="">${choices(f).map(([k, label]) =>
      `<option value="${hee(k)}"${k === str(v) ? " selected" : ""}>${hee(label)}`).join("")}</select>`,
    toDb: empty,
  },
  reference: {
    async read(f, v, app) {
      const ref = await reference(f, app);
      return hee(str(ref && v != null ? await app.db.one`SELECT ${ref.label} FROM ${sql.id(ref.table)} WHERE ${sql.id(ref.key)} = ${v}` ?? v : v));
    },
    async edit(f, v, app) {
      const ref = await reference(f, app);
      if (!ref) return input(f, v);
      // the condition is the field's own setting, written by whoever configures the list: trusted SQL
      const where = f.str("ref_where").trim() || "1=1";
      const rows = await app.db.query`SELECT ${sql.id(ref.key)} AS k, ${ref.label} AS name FROM ${sql.id(ref.table)} WHERE ${sql.raw(where)} ORDER BY name`;
      return `<select data-f="${hee(f.name)}"><option value="">${rows.map((r) =>
        `<option value="${hee(str(r.k))}"${str(r.k) === str(v) ? " selected" : ""}>${hee(str(r.name))}`).join("")}</select>`;
    },
    toDb: empty,
  },
  image: {
    async read(f, v, app) {
      const [w, h] = size(f, 30, 20);
      const file = Number(v) ? await app.dbFiles.file(Number(v)) : undefined;
      return file && await file.exists() ? `<img src="${hee(await file.url({ w, h }))}" alt="" style="width:${w}px; height:${h}px; object-fit:contain">` : "";
    },
    async edit(f, v, app) {
      const [w, h] = size(f, 72, 48);
      const file = Number(v) ? await app.dbFiles.file(Number(v)) : undefined;
      const img = file && await file.exists() ? `<img src="${hee(await file.url({ w, h }))}" alt="" style="width:${w}px; height:${h}px; object-fit:contain">` : "";
      return await fileButtons(f, !!img, app, img);
    },
  },
  file: {
    async read(_f, v, app) {
      const file = Number(v) ? await app.dbFiles.file(Number(v)) : undefined;
      return file && await file.exists() ? `<a href="${hee(await file.url())}" target=_blank>${hee(file.name)}</a>` : "";
    },
    async edit(f, v, app) {
      const link = await types.file.read(f, v, app);
      return await fileButtons(f, !!link, app, link);
    },
  },
};

/** What a file field shows while editable: the file, and buttons to upload, replace or remove it. */
async function fileButtons(f: Field, has: boolean, app: App, shown: string) {
  const name = hee(f.name);
  return `<span class=-file>${shown}<button type=button data-upload="${name}">${has ? await app.t`replace` : await app.t`upload`}</button>` +
    (has ? `<button type=button data-clear="${name}">${await app.t`remove`}</button>` : "") + "</span>";
}

const digits = (f: Field) => Number(f.column.length.split(",")[1] ?? 2);
function decimal(f: Field, v: unknown) {
  if (v == null || v === "") return "";
  return Number(v).toFixed(digits(f)).replace(/\B(?=(\d{3})+(?!\d))/g, "'");
}
/** `size` as `30x20`, else the defaults. */
const size = (f: Field, w: number, h: number) => {
  const [sw, sh] = f.str("size").split("x").map(Number);
  return [sw || w, sh || h];
};

/** The table a reference points to, its key, and what names its rows: `ref_label` — a column or
 *  an expression, written by whoever configures the list: trusted SQL —, else title, name or the key. */
async function reference(f: Field, app: App) {
  const table = parentOf(app, f.table, f.column.name, await app.db.listTables());
  if (!table) return;
  const cols = (await app.db.columns(table).catch(() => [])).map((c) => String(c.Field));
  const key = String((await app.db.columns(table)).find((c) => c.Key === "PRI")?.Field ?? "id");
  const label = f.str("ref_label").trim();
  const name = label ? (cols.includes(label) ? sql.id(label) : sql.raw(label))
    : sql.id(cols.includes("title") ? "title" : cols.includes("name") ? "name" : key);
  return { table, key, label: name };
}

export const TYPES = Object.keys(types);

const type = (f: Field): Type => types[f.type] ?? text;

/** The cell as the field shows it: editable where `edit`, else to read. */
export const show = (f: Field, v: unknown, app: App, edit: boolean): Promise<string> =>
  Promise.resolve(type(f)[edit && f.own ? "edit" : "read"](f, v, app));

/** The value an edit stores; undefined when nothing is to be stored. */
export const toDb = (f: Field, v: string): unknown => (type(f).toDb ?? ((_f: Field, x: string) => x))(f, v);
