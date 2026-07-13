import { Output, unixTime, type Ctx } from "../../core/mod.ts";
import { sha1 } from "./helpers.ts";
import type {} from "../mod.ts";

const BLANK_GIF = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="), c => c.charCodeAt(0));

// Signs trackId and redirect target; "\n" delimits ambiguous id/url boundaries.
export const trackCert = (secret: string, trackId: number, url = "") => sha1("mail1-track" + secret + trackId + "\n" + url).slice(0, 16);

export async function handleTrack(ctx: Ctx): Promise<void> {
  const [idRaw, cert] = String(ctx.req.query.mail1tr ?? "").split("-");
  const trackId = Number(idRaw);
  const url = String(ctx.req.query.url ?? "");
  if (!trackId || !cert || cert !== trackCert(await ctx.app.mail.secure(), trackId, url)) return;

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
    ctx.res.headers.set("Content-Type", "image/gif");
    ctx.res.body = BLANK_GIF;
    throw new Output();
  }
  if (ctx.req.appPath === "mail-track" && /^https?:\/\//.test(url)) {
    ctx.res.status = 302;
    ctx.res.headers.set("Location", url);
    throw new Output();
  }
}
