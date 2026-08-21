import { hee, html, Output, safeEqual, sha256b64url } from "@qino/qino";

import { secret } from "./secret.ts";

import type { App, Ctx } from "@qino/qino";

// Leaving the group a message was sent to. The link says who and which group, and signs it — no
// row is written for it, because a newsletter to ten thousand people would be ten thousand rows
// for a link almost nobody follows, and the one in a mail from last year has to keep working.
//
// A GET only asks. Nothing is dropped without a POST: mail clients, scanners and link previews
// fetch what they find, and a fetched link must not unsubscribe anyone.

const PATH = "messaging/unsubscribe";
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
export async function handle(ctx: Ctx): Promise<void> {
  const path = ctx.req.appPath;
  if (!path.startsWith(PATH + "/")) return; // every request passes here; nothing is allocated to say no
  const app = ctx.app;
  const target = await read(app, path.slice(PATH.length + 1));
  if (!target) throw new Output(await app.t`This unsubscribe link is not valid.`, { status: 404 });

  const group = await app.db.one<string>`SELECT name FROM grp WHERE id = ${target.grpId}`;
  if (ctx.req.method !== "POST") throw new Output(await page(app, group), { headers: HTML });

  await drop(app, target.usrId, target.grpId);
  throw new Output(await page(app, group, true), { headers: HTML });
}

const HTML = { "Content-Type": "text/html; charset=utf-8" };

/** Its own small page: an unsubscribe link is followed by people who are done with this site. */
function page(app: App, group: string | undefined, gone = false) {
  const name = group ?? "";
  return html.async`<!doctype html>
<html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>${app.t`Unsubscribe`}</title></head>
<body>
  ${gone
    ? html`<p>${name ? app.t`You have been removed from ${name}.` : app.t`You have been removed.`}</p>`
    : html`<form method=post>
      <p>${name ? app.t`Do you want to stop receiving messages sent to ${name}?` : app.t`Do you want to stop receiving these messages?`}</p>
      <button>${app.t`Unsubscribe`}</button>
    </form>`}
</body></html>`;
}

/** What a mail carries so the client can offer the one-click way — the url is never shortened. */
export async function headers(app: App, usrId: number, grpId: number): Promise<Record<string, string>> {
  return {
    "List-Unsubscribe": `<${await link(app, usrId, grpId)}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

/** Whether a text asks for the link at all — what decides if the headers are sent. */
export const wanted = (text: string) => text.includes("{{unsubscribe}}");

/** The placeholder's two forms: markup gets a link, plain text gets the address. */
export const forms = (url: string, label: string) => ({
  text: url,
  html: `<a href="${hee(url)}">${hee(label)}</a>`,
});
