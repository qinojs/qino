import { ApiError, requestStorage, unixTime } from "@qino/qino";

import type { App, Ctx } from "@qino/qino";

const today = () => Math.floor(unixTime() / 86400);

/** Count an `ai1:call` for the user whose request caused it. */
export async function count(app: App, e: { input: number; output: number }): Promise<void> {
  const usrId = requestStorage.getStore()?.userId;
  const units = e.input + e.output;
  if (!usrId || !units) return;
  await app.db.table("ai1_usage").ensure({ usr_id: usrId });
  await app.db.exec`UPDATE ai1_usage SET units = CASE WHEN day = ${today()} THEN units + ${units} ELSE ${units} END, day = ${today()} WHERE usr_id = ${usrId}`;
}

/** Refuse the browser API to a user over the daily limit. */
export async function check(ctx: Ctx): Promise<void> {
  const limit = Number(await ctx.app.settings.ai1.dailyLimit);
  if (!limit) return;
  const used = await ctx.app.db.row`SELECT day, units FROM ai1_usage WHERE usr_id = ${ctx.userId}`;
  if (used?.day === today() && used.units >= limit) throw new ApiError(429, await ctx.app.t`The daily AI limit is reached.`);
}
