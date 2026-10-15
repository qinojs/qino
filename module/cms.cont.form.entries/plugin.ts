import { html, sql, tableRef } from "@qino/qino";
import { cms as cmsOf } from "@qino/qino/cms";
import { entryData, fields, uploads } from "@qino/qino/cms.cont.form";
import * as u2 from "@qino/qino/u2";

import api from "./nodeApi.ts";

import type { App, Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const settingsSchema = {
  properties: {
    form: {
      type: "integer",
      minimum: 1,
      description: "The cms.cont.form whose entries are shown. Empty: the first form on this page.",
      "x-html": { type: "qgcms-page" },
    },
    limit: { type: "integer", minimum: 1, default: 20, description: "How many entries are shown." },
    only_if: { type: "string", description: "Only entries whose field of this name is set are shown — a consent checkbox, say." },
    moderated: { type: "boolean", description: "An entry is shown once someone with write access let it through. Its own author sees it before that." },
    fields: { type: "string", description: "Comma-separated field names to show, in that order. Empty: every field, in the order the form asks." },
  },
};

/** The form to show entries of: the configured one, else the first on the page. */
async function formOf(node: Node) {
  const id = Number(node.settings.form());
  if (id) {
    const form = await cmsOf(node.app).node(id);
    return form.exists() && form.vs.module === "cms.cont.form" ? form : undefined;
  }
  const page = [...(await node.path()).values()].findLast((n) => n.vs.type === "p");
  if (!page) return;
  for (const cont of (await page.bough()).values()) if (cont.vs.module === "cms.cont.form") return cont;
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
    FROM ${sql.id(tableRef("form_entry"))} e
    LEFT JOIN ${sql.id(tableRef("log"))} l ON l.id = e.log_id
    WHERE e.node_id = ${form.id} ORDER BY e.created DESC, e.id DESC`;

  const out = [];
  for (const row of rows) {
    const data = entryData(row.data);
    if (opt.onlyIf && data[opt.onlyIf] === undefined) continue;
    const released = !!Number(row.released);
    const mine = !!opt.client && String(row.client_id ?? "") === String(opt.client);
    if (opt.moderated && !released && !opt.all && !mine) continue;
    out.push({ id: Number(row.id), created: Number(row.created), data, released });
    if (out.length >= opt.limit) break;
  }
  return out;
}

/* A form's entries, with the form's fields and labels in order. Styling is up to the site; all
   values look the same. Without `moderated` every saved entry is shown, so don't add this block
   to forms whose entries are private. */
async function render(node: Node, { ctx }: { ctx: Ctx }) {
  const app = node.app;
  u2.assets(ctx, ["el/time/time.js", "el/alert/alert.js", "el/alert/alert.css", "class/width/width.css"]);
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
    onlyIf: String(node.settings.only_if() ?? "").trim(),
    limit: Number(node.settings.limit()) || 20,
    moderated,
    all: mayRelease,
    client: ctx.clientId,
  });
  const files = await uploads(app, rows.map((row) => row.id));
  const all = await fields(form, rows);
  // A chosen list is also the order — and it is what keeps an answer out of a public listing.
  const only = String(node.settings.fields() ?? "").split(",").map((name) => name.trim()).filter((name) => all.has(name));
  const shown = only.length ? only : [...all.keys()];

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
    for (const name of shown) {
      const images = await pictures(row.id, name);
      const value = [row.data[name] ?? ""].flat().join(", ").trim();
      if (!value && !images.length) continue; // a field nobody filled in says nothing
      // explicit `</div>`: a `<div>` doesn't close a `<dd>`, fields would nest otherwise
      lines.push(html`<div class="-field-${name}">
        <dt>${all.get(name)}
        <dd>${images.length ? images : value}
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
      ? html.async`<label class=-release><input type=checkbox data-release="${row.id}"${row.released ? html.raw(" checked") : ""}> ${app.t`Released`}</label>`
      : ""}
    </article>`;
  };

  return html.async`<div class=u2-width>${
    rows.length ? rows.map(entry) : await node.edit() ? html.async`<p>${app.t`No entries yet.`}</p>` : ""
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
