import { hee, html, keyed, Output, safeEqual, sql } from "@qino/qino";

import type { App, Ctx } from "@qino/qino";
import type { Placeholder } from "./template.ts";

// Leave the group a message was sent to. The link contains user and group, signed — no row per
// link (a newsletter would need thousands), and old links keep working.
//
// A GET only asks; only a POST unsubscribes, since mail clients, scanners and previews fetch links.

const NAME = "unsubscribe";
const PATH = "messaging/" + NAME;
const SIG = 8;

/** The link for one recipient, for `{{unsubscribe}}`. */
export async function link(app: App, usrId: number, grpId: number): Promise<string> {
  const stem = `${usrId.toString(36)}-${grpId.toString(36)}`;
  return `${await app.url()}${PATH}/${stem}-${await sign(app, stem)}`;
}

const sign = (app: App, stem: string) => keyed(app, ["messaging.unsubscribe", stem], SIG);

/** User and group of a token, or nothing if it isn't ours. */
async function read(app: App, token: string): Promise<{ usrId: number; grpId: number } | undefined> {
  const cut = token.lastIndexOf("-");
  const stem = token.slice(0, cut);
  const [usr, grp] = stem.split("-");
  const usrId = parseInt(usr, 36);
  const grpId = parseInt(grp, 36);
  if (!(usrId > 0) || !(grpId > 0) || !safeEqual(token.slice(cut + 1), await sign(app, stem))) return;
  return { usrId, grpId };
}

/** Leave the group. Idempotent. */
const drop = (app: App, usrId: number, grpId: number) =>
  app.db.exec`DELETE FROM usr_grp WHERE usr_id = ${usrId} AND grp_id = ${grpId}`;

/**
 * `messaging/unsubscribe/<token>` — GET shows a confirmation page, POST unsubscribes.
 *
 * One-click unsubscribe (RFC 8058) is a POST from the mail client with
 * `List-Unsubscribe=One-Click`; it gets no page.
 */
export async function serveUnsubscribe(ctx: Ctx): Promise<void> {
  const path = ctx.req.appPath;
  if (!path.startsWith(PATH + "/")) return; // runs on every request: bail out cheaply
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

/** A minimal own page, not the site layout. */
async function page(ctx: Ctx, said: string, ask = false, status = 200): Promise<never> {
  const title = await ctx.app.t`Unsubscribe`;
  ctx.res.html.title = title;
  ctx.res.html.content = (await html.async`<main>
  <p>${said}</p>
  ${ask ? html`<form method=post><button>${title}</button></form>` : ""}
</main>`).html;
  ctx.res.status = status;
  throw new Output(); // end the route; ctx.res holds the page
}

/** Which recipients are actually in the group (`{ grp, usr }` also reaches non-members). One
 *  query per send; without a group, none. */
export async function unsubscribeGroup(
  app: App,
  grpId: number | undefined,
  usrIds: (number | undefined)[],
): Promise<(usrId?: number) => number | undefined> {
  const ids = [...new Set(usrIds.filter((id): id is number => !!id))];
  if (grpId == null || !ids.length) return () => undefined;
  const rows = await app.db.col<number>`
    SELECT usr_id FROM usr_grp WHERE grp_id = ${grpId} AND ${sql.in("usr_id", ids)}`;
  const members = new Set(rows.map(Number));
  return (usrId) => usrId && members.has(usrId) ? grpId : undefined;
}

/** Mail headers for one-click unsubscribe — the url is never shortened. */
export async function headers(app: App, usrId: number, grpId: number): Promise<Record<string, string>> {
  return {
    "List-Unsubscribe": `<${await link(app, usrId, grpId)}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

/**
 * `{{unsubscribe}}` — a link in markup, the plain URL in text.
 *
 * Needs `usrId` and `grpId` in the recipient row (set by the channel); otherwise it stays empty.
 */
export const placeholder: Placeholder = async (app, to) => {
  const usrId = Number(to.usrId);
  const grpId = Number(to.grpId);
  if (!usrId || !grpId) return;
  const url = await link(app, usrId, grpId);
  return { text: url, html: html.raw(`<a href="${hee(url)}">${hee(await app.t`Unsubscribe`)}</a>`) };
};
