/* The form being rendered — what its fields collect — and storing a submitted entry; plus what the
 * listings read of it: its fields, entries and uploads. */
import { getCtx, sql, tableRef, unixTime } from "@qino/qino";
import { sortedNames } from "@qino/qino/cms.cont.form.fields";

import type { App, UploadedFile } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

/** From this spam score on an entry is spam: kept and marked, but neither mailed nor shown in public. */
export const SPAM = 0.5;

export class Form {
  /** Submitted values by field name; numbers and checkboxes keep their type into the JSON, a name
   *  sent more than once without a field block (same-named checkboxes) keeps all its values. */
  values: Record<string, string | number | boolean | string[]> = {};
  /** Field name → label, for the mail. */
  labels: Record<string, string> = {};
  /** Field name → the field block that rendered it first: names are one per form. */
  owners = new Map<string, number>();
  /** Uploads waiting to become dbFiles, as the request delivered them. */
  files: { field: string; upload: UploadedFile }[] = [];
  /** Addresses contributed by fields, e.g. a confirmation copy to the sender. */
  recipients: string[] = [];
  replyTo = "";
  /** How likely the entry is spam, 0 to 1; judged once it is valid. */
  spam = 0;
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
    // repeated names arrive as array — the last one counts
    return String((Array.isArray(v) ? v.at(-1) : v) ?? "");
  }
}

const openForms = () => getCtx().state["cms.cont.form"] ??= new Map<number, Form>();

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
 * The fields of all field blocks in `form`, in the order they render, then names only found in
 * `rows` (fields removed since, inputs of static HTML), so their values stay visible: name → label.
 */
export async function fields(form: Node, rows: { data: Record<string, unknown> }[] = []): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const walk = async (node: Node) => {
    for (const cont of await node.conts()) {
      if (cont.vs.module === "cms.cont.form") continue; // a form inside has its own
      if (cont.vs.module === "cms.cont.form.fields") {
        for (const name of sortedNames(cont)) {
          if (!out.has(name)) out.set(name, (await cont.showText(name + "_title")).plain() || name);
        }
      }
      await walk(cont);
    }
  };
  await walk(form);
  for (const row of rows) for (const name of Object.keys(row.data)) if (!out.has(name)) out.set(name, name);
  return out;
}

/** An entry's stored values; a broken row is an empty one rather than taking a listing down. */
export function entryData(json: unknown): Record<string, unknown> {
  try {
    const data = JSON.parse(String(json ?? "") || "{}");
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

/** The uploads of these entries, keyed `<entry>:<field>`, in one query. */
export async function uploads(app: App, ids: number[]): Promise<Map<string, { id: number; name: string; mime: string }[]>> {
  const out = new Map<string, { id: number; name: string; mime: string }[]>();
  if (!ids.length) return out;
  const rows = await app.db.query`
    SELECT ef.entry_id, ef.field, f.id, f.name, f.mime
    FROM ${sql.id(tableRef("form_entry_file"))} ef
    JOIN ${sql.id(tableRef("file"))} f ON f.id = ef.file_id
    WHERE ${sql.in("ef.entry_id", ids)} ORDER BY ef.id`;
  for (const row of rows) {
    out.getOrInsertComputed(`${row.entry_id}:${row.field}`, () => [])
      .push({ id: Number(row.id), name: String(row.name ?? ""), mime: String(row.mime ?? "") });
  }
  return out;
}

/**
 * Store a submitted form; returns the entry id. Uploads become non-public dbFiles (releasing the
 * entry grants access).
 */
export async function keepEntry(node: Node, form: Form): Promise<number> {
  const app = node.app, ctx = getCtx();
  const id = Number(await app.db.table("form_entry").insert({
    node_id: node.id,
    log_id: await ctx.logId,
    created: unixTime(),
    lang: ctx.lang,
    spam: form.spam,
    data: JSON.stringify(form.values),
  }));

  for (const { field, upload } of form.files) {
    const file = await app.dbFiles.add();
    // Not `replaceBy(tmpPath)`: that would keep the temp name and lose the mime type.
    await file.replaceFromUpload(upload);
    await app.db.table("form_entry_file").insert({ entry_id: id, file_id: file.id, field });
  }
  return id;
}
