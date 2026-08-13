import { hee, html, sql, tableRef, unixTime } from "@qino/qino";
import { mail } from "@qino/qino/mail";

import { openForm } from "./mod.ts";
import options from "./options.ts";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Form } from "./mod.ts";

const settingsSchema = {
  properties: {
    recipients: { type: "string", description: "Recipient addresses for submitted entries, separated by comma or newline." },
    redirect: { type: "integer", minimum: 1, description: "Page ID to redirect to after a successful send; without it the success content is shown." },
    button: { type: "boolean", default: true, description: "Shows the submit button." },
    reset: { type: "boolean", description: "Shows a reset button." },
  },
};

/** Contents the module needs to be usable; created once per node. */
async function init(node: Node): Promise<void> {
  if (node.settings.__inited()) return;
  node.settings.__inited(true);
  await node.cont("main", "cms.cont.form2.fields1");
  const success = await node.cont("success", "cms.cont.text");
  await success.text("main", "en", "Thank you<br>We will take care of your request as soon as possible.");
  await success.text("main", "de", "Vielen Dank<br>Wir werden uns schnellstmöglich um Ihr Anliegen kümmern.");
}

/** Seconds since this client was first seen — brand-new clients are almost always bots. Infinity when unknown. */
async function clientAge(ctx: Ctx): Promise<number> {
  if (!ctx.clientId) return Infinity;
  const first = await ctx.app.db.one`SELECT time FROM ${sql.id(tableRef("log"))} WHERE client_id = ${ctx.clientId} ORDER BY time ASC LIMIT 1`;
  return first ? unixTime() - Number(first) : Infinity;
}

/** Bot heuristics. Returns a message when the submit is refused, and flags borderline ones on the form. */
async function spamCheck(node: Node, form: Form, ctx: Ctx): Promise<string> {
  const app = node.app;
  if (form.posted?.your_name) { // honeypot: hidden from humans, filled by bots
    app.fire("suspicious", { ctx, weight: 3, reason: "form2 honeypot filled" });
    return String(await app.t`Your entry looks like spam. Please try again or contact us directly.`);
  }
  const age = await clientAge(ctx);
  if (age < 3) {
    app.fire("suspicious", { ctx, weight: 2, reason: "form2 submit from a brand-new client" });
    return String(await app.t`Your entry could not be sent. Please try again.`);
  }
  if (age < 10) {
    app.fire("suspicious", { ctx, reason: "form2 submit from a very young client" });
    const note = await app.t`This was probably sent by a web robot. Please do NOT move it to the spam folder — that would harm our sender reputation. When in doubt, do not click any link.`;
    form.values = { Attention: String(note), ...form.values };
  }
  return "";
}

/** Build and send the mail. */
async function send(node: Node, form: Form): Promise<boolean> {
  const app = node.app;
  const subject = String(await node.showText("mailSubject")).replace(/<[^>]*>/g, "").trim() ||
    String(await (await node.page()).showTitle());

  let body = String(await node.showText("email_before"));
  for (const [label, value] of Object.entries(form.values)) {
    body += `<p><b>${hee(label)}</b><br>${hee(value).replace(/\n/g, "<br>")}</p>`;
  }
  body += String(await node.showText("email_after"));

  const msg = await mail(app).create({ subject, html: body, replyTo: form.replyTo || undefined });
  for (const file of form.attachments) msg.addFile(file);

  const settingRecipients = String(node.settings.recipients() ?? "").match(/[^\s,;<>]+@[^\s,;<>]+/g) ?? [];
  const to = new Set([...settingRecipients, ...form.recipients]);
  for (const address of to) msg.addTo(address, address);
  return msg.send();
}

async function render(node: Node, { ctx, vars }: { ctx: Ctx; vars: Record<string, unknown> }): Promise<HtmlString> {
  await init(node);
  if (node.edit) ctx.res.html.scripts.add(node.modUrl + "pub/edit.mjs");
  const t = node.app.t;
  const cms = node.cms;
  const edit = node.edit;
  const redirectId = node.settings.redirect();

  // Empty vars mean a plain page view; a JS-free form post and an api render with vars both arrive filled.
  const form = openForm(node);
  if (Object.keys(vars ?? {}).length) form.posted = vars;

  const error = form.sent ? await spamCheck(node, form, ctx) : "";
  if (error) form.errors++;

  // Renders the fields, which report their values into `form` — so this has to run before the decision below.
  const fields = await (await node.cont("main")).html();

  const recipients = String(node.settings.recipients() ?? "").trim();
  const warnings = [];
  if (edit) {
    const success = await node.cont("success", "cms.cont.text");
    if (!recipients) warnings.push(await html.async`<u2-alert open variant=warning>${t`No recipients defined!`}</u2-alert>`);
    if (!redirectId && !String(await success.showText()).replace(/<[^>]*>/g, "").trim()) {
      warnings.push(await html.async`<u2-alert open variant=warning>${t`A confirmation text or a redirect should be defined.`}</u2-alert>`);
    }
  }

  if (form.sent && !form.errors) {
    const sent = await send(node, form);
    if (!sent) {
      return html.async`<div>${warnings}
  <u2-alert open variant=error>${t`Sorry, the form could not be sent. Please contact us directly.`}</u2-alert>
</div>`;
    }
    const redirect = await cms.url(String(redirectId ?? ""));
    if (redirect) {
      ctx.res.headers.set("Location", redirect);
      ctx.res.status = 302;
      return html.raw("<div></div>");
    }
    return html.async`<div>${await (await node.cont("success", "cms.cont.text")).html()}</div>`;
  }

  const button = node.settings.button() ?? true;
  return html.async`<div>${warnings}
  ${error ? html`<u2-alert open variant=error>${error}</u2-alert>` : ""}
  <form method=post enctype="multipart/form-data"${redirectId ? html.raw(" data-native") : ""}>
    ${cms.formFields(node)}
    <input type=text name=your_name autocomplete=off tabindex=-1 aria-hidden=true>
    ${fields}
    <div class=-btns>
      ${node.settings.reset() ? await cms.text(node, "button_reset", { tag: "button", type: "reset", initial: { de: "Zurücksetzen", en: "Reset" } }) : ""}
      ${button && (recipients || edit) ? await cms.text(node, "button_submit", { tag: "button", initial: { de: "Senden", en: "Send" } }) : ""}
    </div>
  </form>
</div>`;
}

export const cms = {
  node: {
    render,
    options,
    settingsSchema,
    css: ["pub/main.css"],
    js: ["pub/main.mjs"],
  },
};
