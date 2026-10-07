import { App, Output, Redirect, s, unixTime } from "@qino/qino";

import { idOf, PATH } from "./lib/url.ts";
import { sync } from "./mod.ts";

import type { Ctx, EventDecls } from "@qino/qino";
import type { Jobs } from "@qino/qino/cron";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

Object.assign(App.events, {
  "payment:status": {
    description: "A payment got a new status, or was recorded — once per change, whoever reported it.",
    data: s.object({
      payment: s.record().describe("The payment row, after the change."),
      previous: s.optional(s.string().describe("The status before; none for a recorded payment.")),
    }),
  },
} satisfies EventDecls);

/** How long open payments are asked after, in case a notification got lost. */
const WATCH = 2 * 24 * 60 * 60;
const FIRST = 600;

export const cron = {
  sync: {
    every: FIRST,
    timeout: 300,
    run: async (app: App) => {
      // a safety net, not polling: each ask waits as long as the payment was old at the last one
      // (`changed` is when it was last asked), so two days take about ten asks
      const now = unixTime();
      const open = await app.db.col`
        SELECT id FROM payment
        WHERE status IN ('pending', 'processing') AND created > ${now - WATCH}
          AND changed < ${now - FIRST} AND ${now} - changed >= changed - created`;
      for (const id of open) await sync(app, Number(id)).catch((e) => console.error("fin.payment sync", id, e));
    },
  },
} satisfies Jobs;

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  app.on("route", ({ ctx }) => handle(ctx), { signal });
}

const PREFIX = PATH + "/";

/** `return/<token>` for the payer, `notify/<token>` for the provider's server. */
async function handle(ctx: Ctx) {
  const path = ctx.req.appPath;
  if (!path.startsWith(PREFIX)) return; // every request passes here
  const [kind, token] = path.slice(PREFIX.length).split("/");
  if (kind !== "return" && kind !== "notify") return;
  const app = ctx.app;
  const id = await idOf(app, token ?? "");
  if (!id) {
    await app.fire("suspicious", { ctx, reason: "fin.payment: forged token" });
    throw new Output("Not Found", { status: 404 });
  }
  if (kind === "notify") throw new Output((await sync(app, id), "ok"));
  // the payer comes back even if the provider is slow to answer; the return page shows what is known
  const payment = await sync(app, id).catch((e) => {
    console.error("fin.payment sync", id, e);
    return app.db.row`SELECT return_url FROM payment WHERE id = ${id}`;
  });
  throw new Redirect(String(payment?.return_url ?? ctx.req.appUrl));
}
