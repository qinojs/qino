import { fs, hee, html, sql } from "@qino/qino";
import { send as sendMail } from "@qino/qino/messaging.email";
import { spamScore } from "@qino/qino/security";
import * as u2 from "@qino/qino/u2";

import { keepEntry, openForm, SPAM } from "./mod.ts";

import type { App, Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Form } from "./mod.ts";

const settingsSchema = {
  properties: {
    button_submit: { type: "boolean", default: true, description: "Shows the submit button; its label is the text of the same name." },
    button_reset: { type: "boolean", description: "Shows a reset button; its label is the text of the same name." },
    recipients: { type: "string", description: "Recipient addresses for submitted entries, separated by comma or newline. Empty: the address from the site's identity." },
    success_page: { type: "integer", minimum: 1, description: "Page ID to redirect to after a successful send; without it the success content is shown." },
    listing_nodes: {
      type: "object",
      additionalProperties: { type: "boolean" },
      description: "Content blocks (cms.cont.form.entries) allowed to show this form's entries in public, by node ID: {\"389\": true}. Only who may edit the form can add one.",
    },
  },
};

/** Contents the module needs to be usable; created once per node. */
async function init(node: Node) {
  if (node.settings.__inited()) return;
  node.settings.__inited(true);
  await node.cont("main", "cms.cont.form.fields");
  const success = await node.cont("success", "cms.cont.text");
  await success.text("main", "en", "Thank you<br>We will take care of your request as soon as possible.");
  await success.text("main", "de", "Vielen Dank<br>Wir werden uns schnellstmöglich um Ihr Anliegen kümmern.");
}

/** How likely the entry is spam. A filled honeypot (hidden from humans) is sure; otherwise security
 *  judges what was sent, by its labels. */
async function spam(node: Node, form: Form, ctx: Ctx) {
  if (form.posted?.your_name) {
    // a bot for sure: it weighs on its address, so what else it sends is suspect too
    node.app.fire("suspicious", { ctx, weight: 15, reason: "form honeypot filled" }).catch(() => {});
    return 1;
  }
  const labeled = Object.fromEntries(
    Object.entries(form.values).map(([name, value]) => [form.labels[name] || name, value]),
  );
  const title = (await node.showTitle()).plain(), page = (await (await node.page()).showTitle()).plain();
  const context = `the form${title ? ` "${title}"` : ""} on the page "${page}"`;
  return await spamScore(node.app, labeled, { ctx, context });
}

/** Upper bounds for an entry, far above any real form: what else it sends, and its size. */
const MAX_FIELDS = 100, MAX_CHARS = 100_000;

/** Whatever else the form sends is kept beside the field blocks' fields: inputs of static HTML
 *  or of other modules. Returns an error when the entry is beyond the bounds. */
async function others(node: Node, form: Form) {
  const rest = Object.entries(form.posted ?? {}).filter(([name]) => name !== "your_name" && !form.owners.has(name));
  for (const [name, value] of rest) {
    const values = [value].flat().filter((v): v is string => typeof v === "string" && v !== "");
    if (values.length) form.values[name] = values.length > 1 ? values : values[0];
  }
  if (rest.length <= MAX_FIELDS && JSON.stringify(form.values).length <= MAX_CHARS) return "";
  return await node.app.t`Your entry is too long.`;
}

/** Recipients: the form's list plus addresses from fields; if none, the site's own address. */
async function recipients(node: Node, form: Form) {
  const own = String(node.settings.recipients() ?? "").match(/[^\s,;<>]+@[^\s,;<>]+/g) ?? [];
  const to = [...new Set([...own, ...form.recipients])];
  if (to.length) return to;
  const owner = String(await node.app.settings.identity.contact.email ?? "").trim();
  return owner ? [owner] : [];
}

/** Build and send the mail — the copy for whoever has to react to an entry. */
async function send(node: Node, form: Form, attachments: { name: string; content: Uint8Array }[]) {
  const app = node.app;
  const subject = (await node.showText("mailSubject")).plain() ||
    (await (await node.page()).showTitle()).plain();

  let body = String(await node.showText("email_before"));
  for (const [name, value] of Object.entries(form.values)) {
    const label = form.labels[name] || name;
    body += `<p><b>${hee(label)}</b><br>${hee([value].flat().join(", ")).replace(/\n/g, "<br>")}</p>`;
  }
  body += String(await node.showText("email_after"));

  const to = await recipients(node, form);
  if (!to.length) return;
  await sendMail(app, { email: to }, {
    title: subject,
    text: body,
    format: "html",
    replyTo: form.replyTo || undefined,
    attachments,
  });
}

async function render(node: Node, { ctx, vars }: { ctx: Ctx; vars: Record<string, unknown> }) {
  await init(node);
  u2.assets(ctx, ["el/alert/alert.js", "el/alert/alert.css", "class/width/width.css", "class/flex/flex.css"]);
  const edit = await node.edit();
  const t = node.app.t;
  const cms = node.cms;
  const successPage = node.settings.success_page();

  // Empty vars = page view; a form post (with or without JS) has vars.
  const form = openForm(node);
  if (Object.keys(vars).length) form.posted = vars;

  // Rendering the fields fills `form` with their values, so it must run before the checks below.
  const fields = await (await node.cont("main")).html();
  const error = form.sent ? await others(node, form) : "";
  if (error) form.errors++;

  const warnings = [];
  if (edit) {
    const success = await node.cont("success", "cms.cont.text");
    if (!successPage && !(await success.showText()).plain()) {
      warnings.push(html.async`<u2-alert open variant=warning>${t`A confirmation text or a redirect should be defined.`}</u2-alert>`);
    }
  }

  if (form.sent && !form.errors) {
    // Spam is kept and marked, but not mailed; the visitor sees the same confirmation, which tells a
    // bot nothing. Keeping comes first: a mail that does not go out must not lose the entry. It
    // moves the uploads away, so the attachments are read before.
    form.spam = await spam(node, form, ctx);
    const mail = form.spam < SPAM;
    const attachments = !mail ? [] : await Promise.all(
      form.files.map(async ({ upload }) => ({ name: upload.name, content: await fs.bytes(upload.tmpPath) })),
    );
    await keepEntry(node, form);
    if (mail) await send(node, form, attachments);
    const redirect = await cms.url(String(successPage ?? ""));
    if (redirect) {
      ctx.res.headers.set("Location", redirect);
      ctx.res.status = 302;
      return html.raw("<div class=u2-width></div>");
    }
    return html.async`<div class=u2-width>${node.cont("success", "cms.cont.text")}</div>`;
  }

  return html.async`<div class=u2-width>${warnings}
  ${error ? html`<u2-alert open variant=error>${error}</u2-alert>` : ""}
  <form method=post enctype="multipart/form-data"${successPage ? html.raw(" data-native") : ""}>
    ${cms.formFields(node)}
    <input type=text name=your_name autocomplete=off tabindex=-1 aria-hidden=true>
    ${fields}
    <div class="-btns u2-flex">
      ${node.settings.button_reset() ? cms.text(node, "button_reset", { tag: "button", type: "reset", initial: { de: "Zurücksetzen", en: "Reset" } }) : ""}
      ${node.settings.button_submit() ?? true ? cms.text(node, "button_submit", { tag: "button", initial: { de: "Senden", en: "Send" } }) : ""}
    </div>
  </form>
</div>`;
}

/** Takes over what the form4 modules left: their nodes, module rows and entries.
 *  Delete once z3280-murten.ch has been migrated — no other site ever ran form4. */
export async function install({ app }: { app: App }): Promise<void> {
  const db = app.db, tables = await db.listTables();
  await db.transaction(async () => {
    for (const name of ["cms.cont.form", "cms.cont.form.fields", "cms.cont.form.entries", "cms.backend.cms.form"]) {
      const old = name.replace(/\.form\b/, ".form4");
      for (const table of ["page", "_vers_page"].filter((t) => tables.includes(t))) {
        await db.exec`UPDATE ${sql.id(table)} SET module = ${name} WHERE module = ${old}`;
      }
      const access = await db.one`SELECT cms_access FROM module WHERE name = ${old}`;
      if (access != null) await db.table("module").ensure({ name, cms_access: access });
      await db.exec`DELETE FROM module WHERE name = ${old}`;
    }
    // settings renamed since, each by the module it belongs to; keep is gone (entries are always kept)
    const move = (o: Record<string, unknown>, from: string, to: string) => {
      if (from in o) o[to] = o[from];
      delete o[from];
    };
    const renames: Record<string, (settings: Record<string, unknown>) => void> = {
      "cms.cont.form": (s) => {
        move(s, "redirect", "success_page");
        delete s.keep;
      },
      "cms.cont.form.fields": (s) => {
        move(s, "sort", "field_order");
        for (const field of Object.values((s.fields ?? {}) as Record<string, Record<string, unknown>>)) {
          move(field, "is-recipient", "copy_to_sender");
          move(field, "disableif", "disable_if");
        }
      },
      "cms.cont.form.entries": (s) => {
        move(s, "onlyIf", "only_if");
        move(s, "fields", "show_fields");
      },
    };
    const parse = (json: unknown) => { try { return JSON.parse(String(json || "{}")); } catch { return undefined; } };
    for (const row of await db.query`SELECT id, module, settings FROM page WHERE ${sql.in("module", Object.keys(renames))} AND settings != ''`) {
      const settings = parse(row.settings);
      if (!settings) continue; // broken: left as it is
      renames[String(row.module)](settings);
      const after = JSON.stringify(settings);
      if (after !== row.settings) await db.exec`UPDATE page SET settings = ${after} WHERE id = ${row.id}`;
    }
    // a listing that was set up before forms had to allow it keeps working
    for (const row of await db.query`SELECT id, settings FROM page WHERE module = 'cms.cont.form.entries' AND settings != ''`) {
      const form = Number(parse(row.settings)?.form) || 0; // none: the first form on its page, chosen anew
      const data = form && parse(await db.one`SELECT settings FROM page WHERE id = ${form} AND module = 'cms.cont.form'`);
      if (!data) continue;
      (data.listing_nodes ??= {})[row.id] = true;
      await db.exec`UPDATE page SET settings = ${JSON.stringify(data)} WHERE id = ${form}`;
    }
    for (const table of ["form_entry", "form_entry_file"]) { // parents first
      const old = table.replace("form", "form4");
      if (!tables.includes(old)) continue;
      for (const row of await db.query`SELECT * FROM ${sql.id(old)}`) await db.table(table).insert(row);
    }
    for (const table of ["form4_entry_file", "form4_entry"].filter((t) => tables.includes(t))) await db.exec`DROP TABLE ${sql.id(table)}`;
  });
}

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

export const cms = {
  node: {
    render,
    widget: "pub/widget.js",
    settingsSchema,
    css: ["pub/main.css"],
    js: ["pub/main.js"],
  },
};
