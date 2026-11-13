import { hee, html, keyed, safeEqual, sql, unixTime } from "@qino/qino";
import * as u2 from "@qino/qino/u2";

import type { App, Ctx } from "@qino/qino";
import type { Placeholder } from "./template.ts";

// Leave the group a message was sent to. The link contains user and group, signed — no row per
// link (a newsletter would need thousands), and old links keep working.
//
// A GET only asks; only a POST unsubscribes, since mail clients, scanners and previews fetch links.
// The link may also name the delivery it came with: the unsubscribe then counts as a click on it.

/** Also the code its clicks are tracked under. */
export const NAME = "unsubscribe";
const NS = "messaging";
const PATH = NS + "/" + NAME;
const SIG = 8;

/** The link for one recipient, for `{{unsubscribe}}`; with the delivery, the unsubscribe is
 *  credited to that message. */
export async function link(app: App, usrId: number, grpId: number, deliveryId?: number): Promise<string> {
  const stem = [usrId, grpId, ...deliveryId ? [deliveryId] : []].map((id) => id.toString(36)).join("-");
  return `${await app.url()}${PATH}/${stem}-${await sign(app, stem)}`;
}

const sign = (app: App, stem: string) => keyed(app, ["messaging.unsubscribe", stem], SIG);

/** User, group and (in newer links) delivery of a token, or nothing if it isn't ours. */
async function read(app: App, token: string) {
  const cut = token.lastIndexOf("-");
  const stem = token.slice(0, cut);
  const [usrId, grpId, deliveryId] = stem.split("-").map((id) => parseInt(id, 36));
  if (!(usrId > 0) || !(grpId > 0) || !safeEqual(token.slice(cut + 1), await sign(app, stem))) return;
  return { usrId, grpId, deliveryId: deliveryId > 0 ? deliveryId : undefined };
}

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
  const t = app.t.in(NS);
  const target = await read(app, path.slice(PATH.length + 1));
  if (!target) return page(ctx, await t`This unsubscribe link is not valid.`, false, 404);

  const group = await app.db.one<string>`SELECT name FROM grp WHERE id = ${target.grpId}`;
  if (ctx.req.method !== "POST") {
    return page(ctx, group ? await t`Stop receiving messages sent to ${group}?` : await t`Stop receiving these messages?`, true);
  }
  await app.db.table("usr_grp").delete({ usr_id: target.usrId, grp_id: target.grpId }); // leave the group, idempotent
  // a click on the message it came with; a deleted delivery fails on the missing parent
  if (target.deliveryId) {
    app.db.table("message_track").insert({ delivery_id: target.deliveryId, code: NAME, kind: "click", time: unixTime() }).catch(() => {});
  }
  return page(ctx, group ? await t`You have been removed from ${group}.` : await t`You have been removed.`);
}

/** A page of its own, apart from any layout: the token is in the url. */
async function page(ctx: Ctx, said: string, ask = false, status = 200): Promise<never> {
  const title = await ctx.app.t.in(NS)`Unsubscribe`;
  return u2.page(ctx, title, html`<p>${said}</p>${ask ? html`<form method=post><button>${title}</button></form>` : ""}`, { status });
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
export async function headers(app: App, usrId: number, grpId: number, deliveryId?: number): Promise<Record<string, string>> {
  return {
    "List-Unsubscribe": `<${await link(app, usrId, grpId, deliveryId)}>`,
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
  const url = await link(app, usrId, grpId, Number(to.deliveryId) || undefined);
  // the recipient's language, not that of whoever's request or job sends it
  const label = await app.t.with({ ns: NS, lang: String(to.lang ?? "") || undefined }, () => app.t`Unsubscribe`);
  return { text: url, html: html.raw(`<a href="${hee(url)}">${hee(label)}</a>`) };
};
