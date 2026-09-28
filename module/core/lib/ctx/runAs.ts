import { Ctx, requestStorage } from "./Ctx.ts";
import { initRequest } from "./init.ts";

import type { App } from "../App.ts";

/** Run `fn` in a context of its own, without an HTTP request (agents, jobs): with the rights of user
 *  `usrId`, through `actor` (e.g. "ai1.tools"), which has its own client and session, so the log
 *  tells it apart from the user. Its request is an internal one to the app's public address,
 *  without headers, body or client IP. `usrId` never from request input. */
export async function runAs<T>(app: App, usrId: number, actor: string, fn: () => T | Promise<T>): Promise<T> {
  if (!usrId) throw new Error("runAs needs a user");
  const url = new URL(await app.url());
  const ctx = await Ctx.create(app, new Request(url), { appUrl: url.pathname, url });
  return requestStorage.run(ctx, async () => {
    try {
      await ctx.authenticate(usrId, actor);
      await initRequest(ctx);
      return await fn();
    } finally {
      await ctx.req.cleanup();
    }
  });
}
