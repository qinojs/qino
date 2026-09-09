/* What the fields of one form report while they render, and where a submitted entry goes.
 * Unlike form2 the fields are addressed by a name the editor typed, and an entry is kept. */
import { getCtx, requestStorage, sql, tableRef, unixTime } from "@qino/qino";

import type { App, UploadedFile } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export class Form {
  /** Submitted values by field name; numbers and checkboxes keep their type into the JSON. */
  values: Record<string, string | number | boolean> = {};
  /** Field name → label, for the mail. */
  labels: Record<string, string> = {};
  /** Uploads waiting to become dbFiles, as the request delivered them. */
  files: { field: string; upload: UploadedFile }[] = [];
  /** Addresses contributed by fields, e.g. a confirmation copy to the sender. */
  recipients: string[] = [];
  replyTo = "";
  /** Failed validations; the form is only accepted at zero. */
  errors = 0;
  /** POST body of this submit, undefined while the form was not sent. */
  posted: Record<string, unknown> | undefined;

  get sent(): boolean {
    return !!this.posted;
  }

  /** Submitted value: "" when sent without it, undefined while not sent at all. */
  value(name: string): string | undefined {
    if (!this.posted) return;
    const v = this.posted[name];
    // repeated names arrive as an array (a checkbox and its empty hidden twin) — the last one counts
    return String((Array.isArray(v) ? v.at(-1) : v) ?? "");
  }
}

const openForms = () => getCtx().state.form4 ??= new Map<number, Form>();

/** Open a form for `node`; everything rendered below it finds it via `formOf()`. */
export function openForm(node: Node): Form {
  const form = new Form();
  openForms().set(node.id, form);
  return form;
}

/** The nearest form `node` renders inside, if any. */
export async function formOf(node: Node): Promise<Form | undefined> {
  const open = openForms();
  if (!open.size) return;
  for (const id of [...(await node.path()).keys()].reverse()) {
    const form = open.get(id);
    if (form) return form;
  }
}

/**
 * Keep one submitted form, returning the entry id. Uploads become dbFiles without public
 * access — whoever releases an entry grants it.
 */
export async function keepEntry(node: Node, form: Form): Promise<number> {
  const app = node.app;
  const id = Number(await app.db.table("form4_entry").insert({
    node_id: node.id,
    log_id: await requestStorage.getStore()?.logId ?? null,
    created: unixTime(),
    lang: getCtx().lang,
    data: JSON.stringify(form.values),
  }));

  for (const { field, upload } of form.files) {
    const file = await app.dbFiles.add();
    // Not `replaceBy(tmpPath)`: that would keep the temp name and lose the mime type.
    await file.replaceFromUpload(upload);
    await app.db.table("form4_entry_file").insert({ entry_id: id, file_id: file.id, field });
  }
  return id;
}

/**
 * Entries of one form, newest first, `data` parsed. `where` adds equality on columns of
 * `form4_entry` — a module that adds a column of its own filters through it.
 */
export async function entries(app: App, node: Node | number, opt: { limit?: number; offset?: number; where?: Record<string, unknown> } = {}) {
  const where = app.db.table("form4_entry").valuesToFragment({ node_id: Number(node), ...opt.where });
  const rows = await app.db.query`
    SELECT id, created, lang, data FROM ${sql.id(tableRef("form4_entry"))} WHERE ${where}
    ORDER BY created DESC, id DESC
    LIMIT ${opt.limit ?? 100} OFFSET ${opt.offset ?? 0}`;
  return rows.map((row) => ({
    id: Number(row.id),
    created: Number(row.created),
    lang: String(row.lang ?? ""),
    data: parse(String(row.data ?? "")),
  }));
}

/** The uploads of these entries, keyed `<entry>:<field>` — one query for a whole listing. */
export async function entryFiles(app: App, ids: number[]) {
  if (!ids.length) return new Map<string, { id: number; name: string; mime: string }[]>();
  const rows = await app.db.query`
    SELECT ef.entry_id, ef.field, f.id, f.name, f.mime
    FROM ${sql.id(tableRef("form4_entry_file"))} ef
    JOIN ${sql.id(tableRef("file"))} f ON f.id = ef.file_id
    WHERE ef.entry_id IN (${sql.join(ids.map((id) => sql`${id}`), ", ")}) ORDER BY ef.id`;
  const out = new Map<string, { id: number; name: string; mime: string }[]>();
  for (const row of rows) {
    const key = `${row.entry_id}:${row.field}`;
    out.set(key, [...(out.get(key) ?? []), { id: Number(row.id), name: String(row.name ?? ""), mime: String(row.mime ?? "") }]);
  }
  return out;
}

function parse(json: string) {
  try {
    const data = JSON.parse(json || "{}");
    return data && typeof data === "object" ? data as Record<string, string | number | boolean> : {};
  } catch {
    return {}; // a broken row must not take a listing down
  }
}
