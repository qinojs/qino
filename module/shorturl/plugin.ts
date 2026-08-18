import { Output, Redirect, unixTime } from "@qino/qino";

import { LEN, PATH, valid } from "./lib/code.ts";

import type { App, Ctx } from "@qino/qino";
import type { Jobs } from "@qino/qino/cron";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

export const settingsSchema = {
  properties: {
    base: { type: "string", description: "Absolute app URL the links get built with — needed to shorten outside a request" },
    _secret: { type: "string", description: "Key the codes are signed with — generated on first use" },
  },
};

const PREFIX = PATH + "/";

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  app.on("route", ({ ctx }) => handleHit(ctx), { signal });
}

export const cron = {
  expired: {
    every: "week",
    jitter: 12 * 60 * 60,
    run: (app) => app.db.exec`DELETE FROM shorturl WHERE expires < ${unixTime()}`,
  },
} satisfies Jobs;

/** `s/<code>` redirects; anything after the code is the caller's own marker. */
async function handleHit(ctx: Ctx): Promise<void> {
  const path = ctx.req.appPath;
  if (!path.startsWith(PREFIX)) return; // every request passes here; nothing is allocated to say no
  const [code, tag] = path.slice(PREFIX.length).split("/");
  // a code of the wrong length was cut or pasted, not guessed — the rest is somebody trying codes
  if (!await valid(ctx.app, code)) {
    const mangled = code.length !== LEN;
    return void await ctx.app.fire("suspicious", {
      ctx,
      weight: mangled ? 0.2 : 1,
      reason: `shorturl: ${mangled ? "mangled" : "forged"} code`,
    });
  }
  const link = await ctx.app.db.row`SELECT * FROM shorturl WHERE code = ${code}`;
  if (!link || (link.expires != null && Number(link.expires) < unixTime())) throw new Output("Gone", { status: 410 });

  ctx.app.db.exec`UPDATE shorturl SET hits = hits + 1, last = ${unixTime()} WHERE code = ${code}`.catch(() => {});
  // whoever tracks clicks listens here — shorturl itself only counts
  await ctx.app.fire("shorturl:hit", { ctx, link, tag });
  throw new Redirect(String(link.url));
}
