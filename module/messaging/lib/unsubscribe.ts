import { hee, html, Output, safeEqual, sha256b64url } from "@qino/qino";

import { secret } from "./secret.ts";

import type { App, Ctx } from "@qino/qino";
import type { Placeholder } from "./template.ts";

// Leaving the group a message was sent to. The link says who and which group, and signs it — no
// row is written for it, because a newsletter to ten thousand people would be ten thousand rows
// for a link almost nobody follows, and the one in a mail from last year has to keep working.
//
// A GET only asks. Nothing is dropped without a POST: mail clients, scanners and link previews
// fetch what they find, and a fetched link must not unsubscribe anyone.

const NAME = "unsubscribe";
const PATH = "messaging/" + NAME;
const SIG = 8;

/** The link for one recipient, ready to be put where `{{unsubscribe}}` stands. */
export async function link(app: App, usrId: number, grpId: number): Promise<string> {
  const stem = `${usrId.toString(36)}-${grpId.toString(36)}`;
  return `${await app.url()}${PATH}/${stem}-${await sign(app, stem)}`;
}

const sign = async (app: App, stem: string) =>
  (await sha256b64url(`${await secret(app)}\0unsubscribe\0${stem}`)).slice(0, SIG);

/** Who and which group a token stands for, or nothing when it is not one we handed out. */
async function read(app: App, token: string): Promise<{ usrId: number; grpId: number } | undefined> {
  const cut = token.lastIndexOf("-");
  const stem = token.slice(0, cut);
  const [usr, grp] = stem.split("-");
  const usrId = parseInt(usr, 36);
  const grpId = parseInt(grp, 36);
  if (!(usrId > 0) || !(grpId > 0) || !safeEqual(token.slice(cut + 1), await sign(app, stem))) return;
  return { usrId, grpId };
}

/** Leave the group. Idempotent: following the link twice is the same as following it once. */
const drop = (app: App, usrId: number, grpId: number) =>
  app.db.exec`DELETE FROM usr_grp WHERE usr_id = ${usrId} AND grp_id = ${grpId}`;

/**
 * `messaging/unsubscribe/<token>` — the page that asks, and the POST that acts.
 *
 * One-click unsubscribing (RFC 8058) is a POST the mail client sends by itself, carrying
 * `List-Unsubscribe=One-Click`; it gets no page and no confirmation, which is the whole point.
 */
export async function serveUnsubscribe(ctx: Ctx): Promise<void> {
  const path = ctx.req.appPath;
  if (!path.startsWith(PATH + "/")) return; // every request passes here; nothing is allocated to say no
  const app = ctx.app;
  const t = app.t;
  const target = await read(app, path.slice(PATH.length + 1));
  if (!target) return page(ctx, await t`This unsubscribe link is not valid.`, false, 404);

  const group = await app.db.one<string>`SELECT name FROM grp WHERE id = ${target.grpId}`;
  if (ctx.req.method !== "POST") {
    return page(ctx, group ? await t`Stop receiving messages sent to ${group}?` : await t`Stop receiving these messages?`, true);
  }
  await drop(app, target.usrId, target.grpId);
  return page(ctx, group ? await t`You have been removed from ${group}.` : await t`You have been removed.`);
}

/** Its own small page: an unsubscribe link is followed by people who are done with this site. */
async function page(ctx: Ctx, said: string, ask = false, status = 200): Promise<never> {
  const title = await ctx.app.t`Unsubscribe`;
  ctx.res.html.title = title;
  ctx.res.html.content = (await html.async`<main>
  <p>${said}</p>
  ${ask ? html`<form method=post><button>${title}</button></form>` : ""}
</main>`).html;
  ctx.res.status = status;
  throw new Output(); // stop the route here — the document on ctx.res is the response
}

/** What a mail carries so the client can offer the one-click way — the url is never shortened. */
export async function headers(app: App, usrId: number, grpId: number): Promise<Record<string, string>> {
  return {
    "List-Unsubscribe": `<${await link(app, usrId, grpId)}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

/**
 * `{{unsubscribe}}` — a link in markup, the bare address in text.
 *
 * The channel puts `usrId` and `grpId` into the recipient row, the same way it hands over
 * `deliveryId`; without them there is no group to leave and the placeholder stays empty.
 */
export const placeholder: Placeholder = async (app, to) => {
  const usrId = Number(to.usrId);
  const grpId = Number(to.grpId);
  if (!usrId || !grpId) return;
  const url = await link(app, usrId, grpId);
  return { text: url, html: `<a href="${hee(url)}">${hee(await app.t`Unsubscribe`)}</a>` };
};
