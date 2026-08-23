import { hee, html, getCtx } from "@qino/qino";
import { send } from "@qino/qino/messaging.email";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export default async function (node: Node, vars: { param?: Record<string, string> } = {}): Promise<HtmlString> {
  const ctx = getCtx();
  const app = node.app;
  const u = ctx.user;
  const firstname = u!.firstname ?? "";
  const lastname  = u!.lastname  ?? "";
  const email     = u!.email     ?? "";

  let feedbackConfirmation = "";
  if (vars.param?.msg) {
    const feedbackEmail = String(await app.settings.cms.feedback.email ?? "").trim();
    if (!feedbackEmail) throw new Error("CMS feedback recipient is not configured");
    const data: Record<string, string> = {
      "Message:": vars.param.msg,
      Link:       vars.param.link ?? "",
      Browser:    ctx.req.header("user-agent") ?? "",
      "E-Mail:":  email,
      Firstname:   firstname,
      Lastname:    lastname,
    };
    const mailHtml = `<h1>CMS feedback</h1><dl>${Object.entries(data).map(([key, value]) =>
      `<dt><strong>${hee(key)}</strong></dt><dd>${hee(value).replaceAll("\n", "<br>")}</dd>`
    ).join("")}</dl>`;
    const sent = await send(app, { email: feedbackEmail }, { title: "CMS feedback", text: mailHtml, format: "html", replyTo: email });
    if (!sent) throw new Error("CMS feedback could not be sent");
    ctx.settings.cms.feedback.text('');
    feedbackConfirmation = `<br><i style="color:#4c4">Thank you for your feedback. <br>We will get back to you as soon as possible.</i><br>`;
  }

  const feedbackEmail = await app.settings.cms.feedback.email ?? "";
  const feedbackText = ctx.settings.cms.feedback.text() ?? "";

  const treeShowC = ctx.settings["cms.frontend.4"].ui.tree_show_c();
  const langVal = String(ctx.settings.core.lang_ns.cms() ?? "");

  return html.async`<div class=more-manager>
  <div class=-standalone>
    <div class=-h1>
      <span>${app.t`Logged in as:`} ${firstname + " " + lastname}</span>
      <div>
        <button class=-tour>${app.t`Start CMS tour`}</button>
        <form method=post style="display:inline"><input type=hidden name=csrfToken value="${ctx.csrfToken}"><button name=core_logout>${app.t`log out`}</button></form>
      </div>
    </div>
  </div>
  ${html.raw(feedbackConfirmation)}
  <div class="-widgetHead -open"><span class=-title>${app.t`Feedback / Support`}</span></div>
  <div>
    <form class=-feedbackform>
      <textarea placeholder="${app.t`Message to:`} ${feedbackEmail}" name=msg required style="width:100%;height:12.5rem">${feedbackText}</textarea>
      <br>
      <button style="padding:.625rem 3.125rem;width:100%">${app.t`send`}</button>
    </form>
  </div>
  <div class=-widgetHead><span class=-title>${app.t`Change password`}</span></div>
  <div>
    <form class=-pwchange>
      <table style="width:13.4375rem" class=c1-padding>
        <tr><td><input autocomplete=current-password style="width:100%" placeholder="${app.t`old password`}" type=password name=old>
        <tr><td><input autocomplete=new-password style="width:100%" placeholder="${app.t`new password`}" type=password name=new>
        <tr><td><input autocomplete=new-password style="width:100%" placeholder="${app.t`repeat new password`}" type=password name=new2>
        <tr><td><button>${app.t`change`}</button>
      </table>
    </form>
  </div>
  <div class=-widgetHead><span class=-title>${app.t`CMS settings`}</span></div>
  <div>
    <table class=-styled style="width:100%">
      <tr>
        <td>${app.t`Language`}
        <td><select class=-changelang name='["core","lang_ns","cms"]'>
          <option value="" ${langVal === "" ? "selected" : ""}>auto (${app.t`like website`})
          ${app.languages.all.map(l => html`<option${langVal === l ? " selected" : ""}>${l}`)}
        </select>
      <tr>
        <td>${app.t`Show content in structure?`}
        <td><input class=-tree-show-c type=checkbox ${treeShowC ? "checked" : ""}>
    </table>
  </div>
  <div class=-widgetHead><span class=-title>${app.t`About`}</span></div>
  <div>
    <a href="https://vanilla-cms.org/de/home" target=_blank>vanilla-cms.org</a><br>
    Feedback welcome!
  </div>
</div>`;
}
