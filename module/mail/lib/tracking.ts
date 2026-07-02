import { Output, unixTime, type RequestContext } from "../../core/mod.ts";
import { sha1 } from "./helpers.ts";
import type {} from "../mod.ts";

const BLANK_GIF = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="), c => c.charCodeAt(0));

export const trackCert = (secret: string, trackId: number) => sha1("mail1-track" + secret + trackId).slice(0, 8);

export async function handleTrack(ctx: RequestContext): Promise<void> {
  const [idRaw, cert] = String(ctx.get.mail1tr ?? "").split("-");
  const trackId = Number(idRaw);
  if (!trackId || !cert || cert !== trackCert(await ctx.app.mail.secure(), trackId)) return;

  const recipient = await ctx.app.db.row`SELECT * FROM mail_recipient WHERE mail1_track_id = ${trackId}`;
  if (!recipient) return;

  const url = String(ctx.get.url ?? "");
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

  if (ctx.appRequestPath === "blank.gif") {
    ctx.responseHeaders.set("Content-Type", "image/gif");
    ctx.responseBody = BLANK_GIF;
    throw new Output();
  }
  if (ctx.appRequestPath === "mail-track" && url) {
    ctx.responseStatus = 302;
    ctx.responseHeaders.set("Location", url);
    throw new Output();
  }
}
