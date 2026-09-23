/* Field values collected during render, and storage of submitted entries. Unlike form2, fields
 * have editor-defined names and entries are stored. */
import { getCtx, requestStorage, unixTime } from "@qino/qino";

import type { UploadedFile } from "@qino/qino";
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
    // repeated names arrive as array (checkbox + hidden fallback) — the last one counts
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
 * Store a submitted form; returns the entry id. Uploads become non-public dbFiles (releasing the
 * entry grants access).
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
