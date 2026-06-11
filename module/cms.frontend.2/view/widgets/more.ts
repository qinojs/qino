import type { Node } from "../../../cms/mod.ts";
import { hee, getCtx } from "../../../core/mod.ts";
import type {} from "../../../mail/mod.ts";

export default async function (node: Node, vars: { param?: Record<string, string> } = {}): Promise<string> {
  const ctx = getCtx();
  const app = node.app;
  const u = ctx.user;
  const firstname = await u!.get?.("firstname") ?? "";
  const lastname  = await u!.get?.("lastname")  ?? "";
  const email     = await u!.get?.("email")     ?? "";

  const logoutUrl = hee(ctx.requestUri || "/");

  let feedbackConfirmation = "";
  if (vars.param?.msg) {
    const feedbackEmail = String(await app.settings.cms.feedback.email ?? "").trim();
    if (!feedbackEmail) throw new Error("CMS feedback recipient is not configured");
    if (!app.mail) throw new Error("CMS feedback requires the mail module");
    const data: Record<string, string> = {
      "Message:": vars.param.msg,
      "Link":     vars.param.link ?? "",
      "Browser":  ctx.req.header("user-agent") ?? "",
      "E-Mail:":  email,
      "Firstname": firstname,
      "Lastname":  lastname,
    };
    const html = `<h1>CMS feedback</h1><dl>${Object.entries(data).map(([key, value]) =>
      `<dt><strong>${hee(key)}</strong></dt><dd>${hee(value).replaceAll("\n", "<br>")}</dd>`
    ).join("")}</dl>`;
    const mail = await app.mail.create({ subject: "CMS feedback", replyTo: email, html });
    mail.addTo(feedbackEmail);
    if (!await mail.send()) throw new Error("CMS feedback could not be sent");
    ctx.settings.cms.feedback.text('');
    feedbackConfirmation = `<br><i style="color:#4c4">Thank you for your feedback. <br>We will get back to you as soon as possible.</i><br>`;
  }

  const feedbackEmail = await app.settings.cms.feedback.email ?? "";
  const feedbackText = ctx.settings.cms.feedback.text() ?? "";

  const treeShowC = ctx.settings["cms.frontend.2"].custom.tree_show_c();
  const langVal = String(ctx.settings.core.lang_ns.cms() ?? "");

  return `<div class=more-manager>
  <div class=-standalone>
    <div class=-h1>
      <span>${await app.t`Logged in as:`} ${hee(firstname + " " + lastname)}</span>
      <form method=post action="${logoutUrl}" style="margin:0"><input type=hidden name=token value="${hee(ctx.token)}"><button name=liveUser_logout>${await app.t`log out`}</button></form>
    </div>
  </div>
  ${feedbackConfirmation}
  <div class="-widgetHead -open"><span class=-title>${await app.t`Feedback / Support`}</span></div>
  <div>
    <form class=-feedbackform>
      <textarea placeholder="${await app.t`Message to:`} ${feedbackEmail}" name=msg required style="width:100%;height:200px">${hee(feedbackText)}</textarea>
      <br>
      <button style="padding:10px 50px;width:100%">${await app.t`send`}</button>
    </form>
  </div>
  <div class=-widgetHead><span class=-title>${await app.t`Change password`}</span></div>
  <div>
    <form class=-pwchange>
      <table style="width:215px" class=c1-padding>
        <tr><td><input autocomplete=current-password style="width:100%" placeholder="${await app.t`old password`}" type=password name=old>
        <tr><td><input autocomplete=new-password style="width:100%" placeholder="${await app.t`new password`}" type=password name=new>
        <tr><td><input autocomplete=new-password style="width:100%" placeholder="${await app.t`repeat new password`}" type=password name=new2>
        <tr><td><button>${await app.t`change`}</button>
      </table>
    </form>
  </div>
  <div class=-widgetHead><span class=-title>${await app.t`CMS settings`}</span></div>
  <div>
    <table class=-styled style="width:100%">
      <tr>
        <td>${await app.t`Language`}
        <td><select class=-changelang name='["core","lang_ns","cms"]'>
          <option value="" ${langVal === "" ? "selected" : ""}>auto (${await app.t`like website`})
          ${app.languages.all.map(l => `<option${langVal === l ? " selected" : ""}>${l}`).join("")}
        </select>
      <tr>
        <td>${await app.t`Show content in structure?`}
        <td><input class=-tree-show-c type=checkbox ${treeShowC ? "checked" : ""}>
    </table>
  </div>
  <div class=-widgetHead><span class=-title>${await app.t`About`}</span></div>
  <div>
    <a href="https://vanilla-cms.org/de/home" target=_blank>vanilla-cms.org</a><br>
    Feedback welcome!
  </div>
</div>`;
}
