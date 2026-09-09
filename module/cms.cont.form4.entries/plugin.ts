import { html } from "@qino/qino";
import { entries, entryFiles } from "@qino/qino/cms.cont.form4";
import { cms as cmsOf } from "@qino/qino/cms";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const settingsSchema = {
  properties: {
    form: {
      type: "integer",
      minimum: 1,
      description: "The cms.cont.form4 whose entries are shown. Empty: the first form on this page.",
      "x-html": { type: "qgcms-page" },
    },
    limit: { type: "integer", minimum: 1, default: 20, description: "How many entries are shown." },
  },
};

/** The form whose entries this block shows — the one it was pointed at, else the first on the page. */
async function formOf(node: Node): Promise<Node | undefined> {
  const id = Number(node.settings.form());
  if (id) {
    const form = await cmsOf(node.app).node(id);
    return form.exists() && form.vs.module === "cms.cont.form4" ? form : undefined;
  }
  const page = [...(await node.path()).values()].reverse().find((n) => n.vs.type === "p");
  if (!page) return;
  for (const cont of (await page.bough()).values()) if (cont.vs.module === "cms.cont.form4") return cont;
}

/**
 * The fields of a form, in the order it asks them, each with its label. Names that only the
 * entries still carry come last: a field that was deleted later keeps its values, and they
 * must not disappear because nothing declares them any more.
 */
async function fieldsOf(form: Node, rows: { data: Record<string, unknown> }[]) {
  const cont = (await form.conts()).find((c) => c.vs.module === "cms.cont.form4.fields");
  const declared = cont ? Object.keys(cont.settings.fields) : [];
  const sorted = String(cont?.settings.sort() ?? "").split(",").filter((name) => declared.includes(name));
  const names = [...sorted, ...declared.filter((name) => !sorted.includes(name))];
  for (const row of rows) for (const name of Object.keys(row.data)) if (!names.includes(name)) names.push(name);

  const out: { name: string; label: string }[] = [];
  for (const name of names) {
    const label = cont ? String(await cont.showText(name + "_title")).replace(/<[^>]*>/g, "").trim() : "";
    out.push({ name, label: label || name });
  }
  return out;
}

/* What visitors sent through a form, entry by entry: the fields the form asks, in its order,
   under the words it asks them in. What that looks like is the site's business — this module
   knows of no field with a meaning of its own, and gives every value the same shape.
   There is no moderation: an entry that is kept is an entry that shows, so a form whose
   entries are not for the public simply does not get one of these blocks. */
async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const app = node.app;
  const form = await formOf(node);
  if (!form) {
    return await node.edit()
      ? html.async`<div><u2-alert open variant=warning>${await app.t`No form found for these entries.`}</u2-alert></div>`
      : html`<div></div>`;
  }

  const rows = await entries(app, form, { limit: Number(node.settings.limit()) || 20 });
  const files = await entryFiles(app, rows.map((row) => row.id));
  const fields = await fieldsOf(form, rows);

  /* Pictures are signed permanently, not for this session: these entries are read by people
     who never sign in. The file stays unlisted — only this link reaches it. */
  const shown = async (entryId: number, name: string) => {
    const out = [];
    for (const file of files.get(`${entryId}:${name}`) ?? []) {
      const dbFile = await app.dbFiles.file(file.id);
      const href = await dbFile.url({ dl: true, grant: "permanent" });
      out.push(
        file.mime.startsWith("image/")
          ? html`<img src="${await dbFile.url({ fmt: "avif", w: 900, max: true, grant: "permanent" })}" alt="${file.name}" loading=lazy>`
          : html`<a href="${href}" download>${file.name}</a>`,
      );
    }
    return out;
  };

  const entry = async (row: { id: number; created: number; data: Record<string, unknown> }) => {
    const lines = [];
    for (const { name, label } of fields) {
      const pictures = await shown(row.id, name);
      const value = String(row.data[name] ?? "").trim();
      if (!value && !pictures.length) continue; // a field nobody filled in says nothing
      // `</div>` has to be written: a `<div>` does not close an open `<dd>`, so without it
      // the next field would nest inside the previous value.
      lines.push(html`<div class="-field-${name}">
        <dt>${label}
        <dd>${pictures.length ? pictures : value}
      </div>`);
    }
    const when = new Date(row.created * 1000);
    return html.async`<article class=-entry>
      <time datetime="${when.toISOString()}">${when.toLocaleDateString(ctx.lang || undefined)}</time>
      <dl>${lines}</dl>
    </article>`;
  };

  return html.async`<div class=u2-width>${
    rows.length ? rows.map(entry) : await node.edit() ? html`<p>${await app.t`No entries yet.`}</p>` : ""
  }</div>`;
}

export const cms = {
  node: {
    render,
    settingsSchema,
  },
};
