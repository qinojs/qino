import { hee, html, sql, tableRef, unixTime } from "@qino/qino";
import { send as sendMail } from "@qino/qino/messaging.email";

import { keepEntry, openForm } from "./mod.ts";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Form } from "./mod.ts";

const settingsSchema = {
  properties: {
    keep: { type: "boolean", default: true, description: "Keeps every entry in the database, where a listing can read it." },
    button_submit: { type: "boolean", default: true, description: "Shows the submit button; its label is the text of the same name." },
    button_reset: { type: "boolean", description: "Shows a reset button; its label is the text of the same name." },
    recipients: { type: "string", description: "Recipient addresses for submitted entries, separated by comma or newline. Empty: the address from the site's identity." },
    redirect: { type: "integer", minimum: 1, description: "Page ID to redirect to after a successful send; without it the success content is shown." },
  },
};

/** Contents the module needs to be usable; created once per node. */
async function init(node: Node): Promise<void> {
  if (node.settings.__inited()) return;
  node.settings.__inited(true);
  await node.cont("main", "cms.cont.form4.fields");
  const success = await node.cont("success", "cms.cont.text");
  await success.text("main", "en", "Thank you<br>We will take care of your request as soon as possible.");
  await success.text("main", "de", "Vielen Dank<br>Wir werden uns schnellstmöglich um Ihr Anliegen kümmern.");
}

/** Seconds since this client was first seen — brand-new clients are almost always bots. Infinity when unknown. */
async function clientAge(ctx: Ctx): Promise<number> {
  if (!ctx.clientId) return Infinity;
  const first = await ctx.app.db.one`SELECT time FROM ${sql.id(tableRef("log"))} WHERE client_id = ${ctx.clientId} ORDER BY id ASC LIMIT 1`;
  return first ? unixTime() - Number(first) : Infinity;
}

/** Bot heuristics, as in form2: an entry that fails them is refused before it is kept. */
async function spamCheck(node: Node, form: Form, ctx: Ctx): Promise<string> {
  const app = node.app;
  if (form.posted?.your_name) { // honeypot: hidden from humans, filled by bots
    app.fire("suspicious", { ctx, weight: 3, reason: "form4 honeypot filled" });
    return await app.t`Your entry looks like spam. Please try again or contact us directly.`;
  }
  const age = await clientAge(ctx);
  if (age < 3) {
    app.fire("suspicious", { ctx, weight: 2, reason: "form4 submit from a brand-new client" });
    return await app.t`Your entry could not be sent. Please try again.`;
  }
  if (age < 10) app.fire("suspicious", { ctx, reason: "form4 submit from a very young client" });
  return "";
}

/** Who gets the entry: the form's own list plus what a field contributed — and when a form
 *  names nobody, the address the site identifies itself with. */
async function recipients(node: Node, form?: Form): Promise<string[]> {
  const own = String(node.settings.recipients() ?? "").match(/[^\s,;<>]+@[^\s,;<>]+/g) ?? [];
  const to = [...new Set([...own, ...(form?.recipients ?? [])])];
  if (to.length) return to;
  const owner = String(await node.app.settings.identity.contact.email ?? "").trim();
  return owner ? [owner] : [];
}

/** Build and send the mail — the copy for whoever has to react to an entry. */
async function send(node: Node, form: Form): Promise<boolean> {
  const app = node.app;
  const subject = String(await node.showText("mailSubject")).replace(/<[^>]*>/g, "").trim() ||
    String(await (await node.page()).showTitle());

  let body = String(await node.showText("email_before"));
  for (const [name, value] of Object.entries(form.values)) {
    const label = form.labels[name] || name;
    body += `<p><b>${hee(label)}</b><br>${hee(String(value)).replace(/\n/g, "<br>")}</p>`;
  }
  body += String(await node.showText("email_after"));

  const to = await recipients(node, form);
  if (!to.length) return true; // nothing to send is not a failure — the entry is kept
  const attachments = form.files.map(({ upload }) => ({ name: upload.name, content: Deno.readFile(upload.tmpPath) }));
  return await sendMail(app, { email: to }, {
    title: subject,
    text: body,
    format: "html",
    replyTo: form.replyTo || undefined,
    attachments,
  }) > 0;
}

async function render(node: Node, { ctx, vars }: { ctx: Ctx; vars: Record<string, unknown> }): Promise<HtmlString> {
  await init(node);
  const edit = await node.edit();
  const t = node.app.t;
  const cms = node.cms;
  const redirectId = node.settings.redirect();
  const keep = node.settings.keep() ?? true;

  // Empty vars mean a plain page view; a JS-free form post and an api render with vars both arrive filled.
  const form = openForm(node);
  if (Object.keys(vars).length) form.posted = vars;

  const error = form.sent ? await spamCheck(node, form, ctx) : "";
  if (error) form.errors++;

  // Renders the fields, which report their values into `form` — so this has to run before the decision below.
  const fields = await (await node.cont("main")).html();

  const warnings = [];
  const mailed = edit || !keep ? (await recipients(node)).length > 0 : true;
  if (edit) {
    const success = await node.cont("success", "cms.cont.text");
    if (!keep && !mailed) warnings.push(await html.async`<u2-alert open variant=warning>${t`Entries are neither kept nor sent — they would be lost.`}</u2-alert>`);
    if (!redirectId && !String(await success.showText()).replace(/<[^>]*>/g, "").trim()) {
      warnings.push(await html.async`<u2-alert open variant=warning>${t`A confirmation text or a redirect should be defined.`}</u2-alert>`);
    }
  }

  if (form.sent && !form.errors) {
    // Keeping comes first: a mail that does not go out must not lose the entry.
    if (keep) await keepEntry(node, form);
    const sent = await send(node, form);
    if (!sent && !keep) {
      return html.async`<div class=u2-width>${warnings}
  <u2-alert open variant=error>${t`Sorry, the form could not be sent. Please contact us directly.`}</u2-alert>
</div>`;
    }
    const redirect = await cms.url(String(redirectId ?? ""));
    if (redirect) {
      ctx.res.headers.set("Location", redirect);
      ctx.res.status = 302;
      return html.raw("<div class=u2-width></div>");
    }
    return html.async`<div class=u2-width>${await (await node.cont("success", "cms.cont.text")).html()}</div>`;
  }

  return html.async`<div class=u2-width>${warnings}
  ${error ? html`<u2-alert open variant=error>${error}</u2-alert>` : ""}
  <form method=post enctype="multipart/form-data"${redirectId ? html.raw(" data-native") : ""}>
    ${cms.formFields(node)}
    <input type=text name=your_name autocomplete=off tabindex=-1 aria-hidden=true>
    ${fields}
    <div class="-btns u2-flex">
      ${node.settings.button_reset() ? await cms.text(node, "button_reset", { tag: "button", type: "reset", initial: { de: "Zurücksetzen", en: "Reset" } }) : ""}
      ${(node.settings.button_submit() ?? true) && (keep || mailed || edit) ? await cms.text(node, "button_submit", { tag: "button", initial: { de: "Senden", en: "Send" } }) : ""}
    </div>
  </form>
</div>`;
}

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

export const cms = {
  node: {
    render,
    widget: "pub/widget.js",
    settingsSchema,
    css: ["pub/main.css"],
    js: ["pub/main.mjs"],
  },
};
