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
    // a bot for sure: its address's next entries are spam for a while, a second honeypot blocks it
    node.app.fire("suspicious", { ctx, weight: 15, reason: "form honeypot filled" }).catch(() => {});
    return 1;
  }
  const labeled = Object.fromEntries(Object.entries(form.values).map(([name, value]) => [form.labels[name] || name, value]));
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
    // Keeping comes first: a mail that does not go out must not lose the entry. It moves the
    // uploads away, so the attachments are read before.
    // Spam is kept and marked, but not mailed; the visitor sees the same confirmation, which tells a
    // bot nothing.
    form.spam = await spam(node, form, ctx);
    const mail = form.spam < SPAM;
    const attachments = !mail ? [] : await Promise.all(form.files.map(async ({ upload }) => ({ name: upload.name, content: await fs.bytes(upload.tmpPath) })));
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
    // settings renamed since: redirect, is-recipient, disableif, onlyIf; keep is gone
    const renamed = (settings: Record<string, unknown>) => {
      if ("redirect" in settings) settings.success_page = settings.redirect;
      if ("onlyIf" in settings) settings.only_if = settings.onlyIf;
      delete settings.redirect;
      delete settings.onlyIf;
      delete settings.keep; // entries are always kept
      for (const field of Object.values((settings.fields ?? {}) as Record<string, Record<string, unknown>>)) {
        if ("is-recipient" in field) field.copy_to_sender = field["is-recipient"];
        if ("disableif" in field) field.disable_if = field.disableif;
        delete field["is-recipient"];
        delete field.disableif;
      }
      return settings;
    };
    for (const row of await db.query`SELECT id, settings FROM page WHERE module IN ('cms.cont.form', 'cms.cont.form.fields', 'cms.cont.form.entries') AND settings != ''`) {
      const before = String(row.settings), after = JSON.stringify(renamed(JSON.parse(before)));
      if (after !== before) await db.exec`UPDATE page SET settings = ${after} WHERE id = ${row.id}`;
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
