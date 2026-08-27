// The field modules render below a form and report into it.
import { getCtx } from "@qino/qino";

import type { Node } from "@qino/qino/cms";

/** What the fields of one form report back while they render. */
export class Form {
  /** Submitted values keyed by field label — the mail body is built from these. */
  values: Record<string, string> = {};
  attachments: { path: string; name: string }[] = [];
  /** Addresses contributed by fields, e.g. a confirmation copy to the sender. */
  recipients: string[] = [];
  replyTo = "";
  /** Failed validations; the form is only sent at zero. */
  errors = 0;
  /** POST body of this submit, undefined while the form was not sent. */
  posted: Record<string, unknown> | undefined;

  get sent(): boolean { return !!this.posted; }

  /** Submitted value of a field: "" when sent without it, undefined while not sent at all. */
  value(name: string): string | undefined {
    if (!this.posted) return;
    const v = this.posted[name];
    // repeated names arrive as an array (a checkbox and its empty hidden twin) — the last one counts
    return String((Array.isArray(v) ? v.at(-1) : v) ?? "");
  }
}

const openForms = (): Map<number, Form> => getCtx().state.form2 ??= new Map();

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
