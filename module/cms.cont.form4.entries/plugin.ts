import { html, sql, tableRef } from "@qino/qino";
import { cms as cmsOf } from "@qino/qino/cms";

import api from "./nodeApi.ts";

import type { App, Ctx, HtmlString } from "@qino/qino";
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
    onlyIf: { type: "string", description: "Only entries whose field of this name is set are shown — a consent checkbox, say." },
    moderated: { type: "boolean", description: "An entry is shown once someone with write access let it through. Its own author sees it before that." },
    fields: { type: "string", description: "Comma-separated field names to show, in that order. Empty: every field, in the order the form asks." },
  },
};

/** The form to show entries of: the configured one, else the first on the page. */
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
 * The form's fields in order, with labels. Fields only found in entries (deleted later) come last,
 * so their values stay visible.
 */
async function fieldsOf(form: Node, rows: { data: Record<string, unknown> }[], only: string[]) {
  const cont = (await form.conts()).find((c) => c.vs.module === "cms.cont.form4.fields");
  const declared = cont ? Object.keys(cont.settings.fields) : [];
  const sorted = String(cont?.settings.sort() ?? "").split(",").filter((name) => declared.includes(name));
  let names = [...sorted, ...declared.filter((name) => !sorted.includes(name))];
  for (const row of rows) for (const name of Object.keys(row.data)) if (!names.includes(name)) names.push(name);
  // A chosen list is also the order — and it is what keeps an answer out of a public listing.
  if (only.length) names = only.filter((name) => names.includes(name));

  const out: { name: string; label: string }[] = [];
  for (const name of names) {
    const label = cont ? (await cont.showText(name + "_title")).plain() : "";
    out.push({ name, label: label || name });
  }
  return out;
}

/**
 * A form's entries, newest first (own query, no shared helper).
 *
 * `onlyIf`: a field the entry must have, e.g. a consent checkbox (unticked sends nothing). Checked
 * in JS, since JSON paths differ per database.
 */
async function read(app: App, form: Node, opt: { onlyIf: string; limit: number; moderated: boolean; all: boolean; client: unknown }) {
  /* The client comes from the entry's log row, so an unreleased entry is shown to its author only. */
  const rows = await app.db.query`
    SELECT e.id, e.created, e.data, e.released, l.client_id
    FROM ${sql.id(tableRef("form4_entry"))} e
    LEFT JOIN ${sql.id(tableRef("log"))} l ON l.id = e.log_id
    WHERE e.node_id = ${form.id} ORDER BY e.created DESC, e.id DESC`;

  const out = [];
  for (const row of rows) {
    let data: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(String(row.data ?? "") || "{}");
      if (parsed && typeof parsed === "object") data = parsed;
    } catch { /* a broken row shows as an empty one; it does not take the listing down */ }
    if (opt.onlyIf && data[opt.onlyIf] === undefined) continue;
    const released = !!Number(row.released);
    const mine = !!opt.client && String(row.client_id ?? "") === String(opt.client);
    if (opt.moderated && !released && !opt.all && !mine) continue;
    out.push({ id: Number(row.id), created: Number(row.created), data, released });
    if (out.length >= opt.limit) break;
  }
  return out;
}

/** The uploads of these entries, keyed `<entry>:<field>` — one query for the whole listing. */
async function uploads(app: App, ids: number[]) {
  const out = new Map<string, { id: number; name: string; mime: string }[]>();
  if (!ids.length) return out;
  const rows = await app.db.query`
    SELECT ef.entry_id, ef.field, f.id, f.name, f.mime
    FROM ${sql.id(tableRef("form4_entry_file"))} ef
    JOIN ${sql.id(tableRef("file"))} f ON f.id = ef.file_id
    WHERE ${sql.in("ef.entry_id", ids)} ORDER BY ef.id`;
  for (const row of rows) {
    out.getOrInsertComputed(`${row.entry_id}:${row.field}`, () => [])
      .push({ id: Number(row.id), name: String(row.name ?? ""), mime: String(row.mime ?? "") });
  }
  return out;
}

/* A form's entries, with the form's fields and labels in order. Styling is up to the site; all
   values look the same. Without `moderated` every saved entry is shown, so don't add this block
   to forms whose entries are private. */
async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const app = node.app;
  const form = await formOf(node);
  if (!form) {
    return await node.edit()
      ? html.async`<div><u2-alert open variant=warning>${app.t`No form found for these entries.`}</u2-alert></div>`
      : html`<div></div>`;
  }

  /* Releasing only in edit mode; outside it, the page looks like for visitors (no waiting entries). */
  const mayRelease = await node.edit();
  const moderated = !!node.settings.moderated();
  if (mayRelease && moderated) ctx.res.html.scripts.add(node.modUrl + "pub/edit.mjs");

  const rows = await read(app, form, {
    onlyIf: String(node.settings.onlyIf() ?? "").trim(),
    limit: Number(node.settings.limit()) || 20,
    moderated,
    all: mayRelease,
    client: ctx.clientId,
  });
  const files = await uploads(app, rows.map((row) => row.id));
  const only = String(node.settings.fields() ?? "").split(",").map((name) => name.trim()).filter(Boolean);
  const fields = await fieldsOf(form, rows, only);

  /**
   * Images only, re-encoded via transform (an svg with a script becomes a plain image). Other files
   * are neither shown nor linked — no unknown files under our domain. They remain in the backend.
   *
   * The urls are signed permanently, since readers aren't signed in. Only this link reaches the file.
   */
  const pictures = async (entryId: number, name: string) => {
    const out = [];
    for (const file of files.get(`${entryId}:${name}`) ?? []) {
      if (!file.mime.startsWith("image/")) continue;
      const src = await (await app.dbFiles.file(file.id)).url({ fmt: "avif", w: 900, max: true, grant: "permanent" });
      out.push(html`<img src="${src}" alt="${file.name}" loading=lazy>`);
    }
    return out;
  };

  const entry = async (row: { id: number; created: number; released: boolean; data: Record<string, unknown> }) => {
    const lines = [];
    for (const { name, label } of fields) {
      const shown = await pictures(row.id, name);
      const value = String(row.data[name] ?? "").trim();
      if (!value && !shown.length) continue; // a field nobody filled in says nothing
      // explicit `</div>`: a `<div>` doesn't close a `<dd>`, fields would nest otherwise
      lines.push(html`<div class="-field-${name}">
        <dt>${label}
        <dd>${shown.length ? shown : value}
      </div>`);
    }
    const when = new Date(row.created * 1000);
    const waiting = moderated && !row.released;
    /* `<u2-time>` shows "three days ago"; without JS the localized date inside stays.
       (Not `u2.el.time()`: its fallback is the ISO string.) */
    return html.async`<article class="-entry${waiting ? " -pending" : ""}">
      <u2-time datetime="${when.toISOString()}" type=relative>${when.toLocaleDateString(ctx.lang || undefined)}</u2-time>
      <dl>${lines}</dl>
      ${mayRelease && moderated
      ? html`<label class=-release><input type=checkbox data-release="${row.id}"${row.released ? html.raw(" checked") : ""}> ${await app.t`Released`}</label>`
      : ""}
    </article>`;
  };

  return html.async`<div class=u2-width>${
    rows.length ? rows.map(entry) : await node.edit() ? html`<p>${await app.t`No entries yet.`}</p>` : ""
  }</div>`;
}

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

export const cms = {
  node: {
    render,
    settingsSchema,
    api,
  },
};
