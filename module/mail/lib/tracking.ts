import { Output, Redirect, unixTime } from "@qino/qino";

import { trackCert } from "./helpers.ts";
import { mail } from "../mod.ts";

import type { Ctx } from "@qino/qino";

const BLANK_GIF = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="), c => c.charCodeAt(0));

export async function handleTrack(ctx: Ctx): Promise<void> {
  const [idRaw, cert] = String(ctx.req.query.mail1tr ?? "").split("-");
  const trackId = Number(idRaw);
  const url = String(ctx.req.query.url ?? "");
  if (!trackId || !cert || cert !== trackCert(await mail(ctx.app).secure(), trackId, url)) return;

  // cert is stateless: track if the recipient still exists, redirect either way
  const recipient = await ctx.app.db.row`SELECT * FROM mail_recipient WHERE mail1_track_id = ${trackId}`;
  if (recipient) {
    await ctx.app.db.table("mail1_track").insert({
      track_id: trackId,
      url,
      time: unixTime(),
      log_id: await ctx.logId,
    });
    if (!recipient.opened) {
      await ctx.app.db.table("mail_recipient").update({
        mail_id: recipient.mail_id,
        email: recipient.email,
        opened: unixTime(),
      });
    }
  }

  if (ctx.req.appPath === "blank.gif") {
    throw new Output(BLANK_GIF, { headers: { "Content-Type": "image/gif" } });
  }
  if (ctx.req.appPath === "mail-track" && /^https?:\/\//.test(url)) {
    throw new Redirect(url);
  }
}
