import type { Node } from "../../../cms/lib/Node.ts";
import { hee } from "../../../core/lib/util.ts"
import { getCtx } from "../../../core/lib/RequestContext.ts";
// deno-lint-ignore-file no-explicit-any

export default async function (node: Node, vars: any = {}): Promise<string> {
  const ctx = getCtx();
  const app = node.app;
  const u = ctx.user;
  const firstname = await u!.get?.("firstname") ?? "";
  const lastname  = await u!.get?.("lastname")  ?? "";
  const email     = await u!.get?.("email")     ?? "";

  const logoutUrl = hee(ctx.requestUri || "/");

  let feedbackConfirmation = "";
  if (vars.param?.msg) {
    const arr: Record<string, string> = {
      "Message:": vars.param.msg,
      "Link":     vars.param.link ?? "",
      "Browser":  ctx.req.header("user-agent") ?? "",
      "E-Mail:":  email,
      "Firstname": firstname,
      "Lastname":  lastname,
    };
    // const Mail = app.db.table("mail").Entry();
    // Mail.subject  = "CMS feedback";
    // Mail.reply_to = email;
    // Mail.html     = JSON.stringify(arr);
    // const feedbackEmail = await app.settings.cms.feedback.email ?? "";
    // await Mail.addTo?.(feedbackEmail);
    // await Mail.send?.();
    ctx.settings.cms.feedback.text('');
    feedbackConfirmation = `<br><i style="color:#4c4">Danke für Ihr Feedback. <br>Wir werden uns so schnell wie möglich bei Ihnen melden.</i><br>`;
  }

  const feedbackEmail = await app.settings.cms.feedback.email ?? "";
  const feedbackText = ctx.settings.cms.feedback.text() ?? "";

  const treeShowC = ctx.settings["cms.frontend.1"].custom.tree_show_c();
  const langVal = String(ctx.settings.core.lang_ns.cms() ?? "");

  return `<div class=qgCmsFront1MoreManager>
  <div class=-standalone>
    <div class=-h1>
      <span>${await app.t`Angemeldet als:`} ${hee(firstname + " " + lastname)}</span>
      <form method=post action="${logoutUrl}" style="margin:0"><input type=hidden name=token value="${hee(ctx.token)}"><button name=liveUser_logout>${await app.t`abmelden`}</button></form>
    </div>
  </div>
  ${feedbackConfirmation}
  <div class="-widgetHead -open"><span class=-title>${await app.t`Feedback / Support`}</span></div>
  <div>
    <form class=-feedbackform>
      <textarea placeholder="${await app.t`Nachricht an:`} ${feedbackEmail}" name=msg required style="width:100%;height:200px">${hee(feedbackText)}</textarea>
      <br>
      <button style="padding:10px 50px;width:100%">senden</button>
    </form>
  </div>
  <div class=-widgetHead><span class=-title>${await app.t`Passwort ändern`}</span></div>
  <div>
    <form class=-pwchange>
      <table style="width:215px" class=c1-padding>
        <tr><td><input autocomplete=current-password style="width:100%" placeholder="${await app.t`altes Passwort`}" type=password name=old>
        <tr><td><input autocomplete=new-password style="width:100%" placeholder="${await app.t`neues Passwort`}" type=password name=new>
        <tr><td><input autocomplete=new-password style="width:100%" placeholder="${await app.t`neues Passwort wiederholen`}" type=password name=new2>
        <tr><td><button>${await app.t`ändern`}</button>
      </table>
    </form>
  </div>
  <div class=-widgetHead><span class=-title>${await app.t`CMS Einstellungen`}</span></div>
  <div>
    <table class=-styled style="width:100%">
      <tr>
        <td>${await app.t`Sprache`}
        <td><select class=-changelang name='["core","lang_ns","cms"]'>
          <option value="" ${langVal === "" ? "selected" : ""}>auto (${await app.t`Wie Website`})
          ${app.languages.all.map(l => `<option${langVal === l ? " selected" : ""}>${l}`).join("")}
        </select>
      <tr>
        <td>${await app.t`Inhalte in der Struktur darstellen?`}
        <td><input class=-tree-show-c type=checkbox ${treeShowC ? "checked" : ""}>
    </table>
  </div>
  <div class=-widgetHead><span class=-title>${await app.t`About`}</span></div>
  <div>
    <a href="https://vanilla-cms.org/de/home" target=_blank>vanilla-cms.org</a><br>
    Feedback willkommen!
  </div>
</div>`;
}
