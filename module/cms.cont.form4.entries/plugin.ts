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
    heading: { type: "string", description: "Field whose value titles an entry. Default: name." },
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

/** Field name → label, so an entry reads with the words the form asked in. */
async function labels(form: Node): Promise<Record<string, string>> {
  const fields = (await form.conts()).find((c) => c.vs.module === "cms.cont.form4.fields");
  const out: Record<string, string> = {};
  if (!fields) return out;
  for (const name of Object.keys(fields.settings.fields)) {
    out[name] = String(await fields.showText(name + "_title")).replace(/<[^>]*>/g, "").trim() || name;
  }
  return out;
}

const previewable = (mime: string) => mime.startsWith("image/");

/* What visitors wrote into a form, as it came in. There is no moderation here: an entry that
   is kept is an entry that shows, and a form whose entries are not for the public simply does
   not get one of these blocks. */
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
  const label = await labels(form);
  const heading = String(node.settings.heading() ?? "") || "name";

  /* The pictures are signed permanently, not for this session: a guest book is read by people
     who never sign in. The file stays unlisted — only this link reaches it. */
  const pictures = async (entryId: number) => {
    const shown = [];
    for (const [key, list] of files) {
      if (!key.startsWith(entryId + ":")) continue;
      for (const file of list) {
        if (!previewable(file.mime)) continue;
        const dbFile = await app.dbFiles.file(file.id);
        const src = await dbFile.url({ fmt: "avif", w: 900, max: true, grant: "permanent" });
        shown.push(html`<img src="${src}" alt="${file.name}" loading=lazy>`);
      }
    }
    return shown;
  };

  const entry = async (row: { id: number; created: number; data: Record<string, unknown> }) => {
    const title = String(row.data[heading] ?? "").trim();
    const rest = Object.entries(row.data).filter(([name, value]) =>
      name !== heading && String(value ?? "").trim() !== ""
    );
    return html.async`<article class=-entry>
      <header>
        ${title ? html`<b class=-who>${title}</b>` : ""}
        <time datetime="${new Date(row.created * 1000).toISOString()}">${
      new Date(row.created * 1000).toLocaleDateString(ctx.lang || "de")
    }</time>
      </header>
      ${rest.map(([name, value]) => html`<p class="-said -said-${name}"><span class=-label>${label[name] ?? name}</span>${String(value)}</p>`)}
      ${await pictures(row.id)}
    </article>`;
  };

  return html.async`<div class=-entries>${
    rows.length ? rows.map(entry) : await node.edit() ? html`<p>${await app.t`No entries yet.`}</p>` : ""
  }</div>`;
}

export const cms = {
  node: {
    render,
    settingsSchema,
    css: ["pub/main.css"],
  },
};
