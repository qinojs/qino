import { App, html, Output, Redirect, s, unixTime } from "@qino/qino";

import { idOf, PATH } from "./lib/url.ts";
import { provider, slip, sync } from "./mod.ts";

import type { Ctx, EventDecls } from "@qino/qino";
import type { Jobs } from "@qino/qino/cron";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };
export { api } from "./api.ts";

Object.assign(App.events, {
  "payment:change": {
    description: "A payment was recorded, got a new status, or money moved — once per change, whoever reported it.",
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

/** `return/<token>` for the payer, `notify/<token>` for the provider's server, `pay/<token>` shows
 *  the slip, `webhook/<provider>` takes a provider's notifications for all its payments. */
async function handle(ctx: Ctx) {
  const path = ctx.req.appPath;
  if (!path.startsWith(PREFIX)) return; // every request passes here
  const [kind, token] = path.slice(PREFIX.length).split("/");
  const app = ctx.app;
  if (kind === "webhook") {
    const ids = await provider(app, token ?? "")?.webhook?.(ctx);
    if (!ids) throw new Output("Not Found", { status: 404 });
    for (const id of ids) await sync(app, id);
    throw new Output("ok");
  }
  if (kind !== "return" && kind !== "notify" && kind !== "pay") return;
  const id = await idOf(app, token ?? "");
  if (!id) {
    await app.fire("suspicious", { ctx, reason: "fin.payment: forged token" });
    throw new Output("Not Found", { status: 404 });
  }
  if (kind === "notify") throw new Output((await sync(app, id), "ok"));
  if (kind === "pay") throw await payPage(app, id);
  // the payer comes back even if the provider is slow to answer; the return page shows what is known
  const payment = await sync(app, id).catch((e) => {
    console.error("fin.payment sync", id, e);
    return app.db.row`SELECT return_url FROM payment WHERE id = ${id}`;
  });
  throw new Redirect(String(payment?.return_url ?? ctx.req.appUrl));
}

/** The slip on a page of its own. A watched one asks again while open, and leads on once paid. */
async function payPage(app: App, id: number): Promise<Output> {
  const payment = await app.db.row`SELECT provider, return_url FROM payment WHERE id = ${id}`;
  const watch = !!provider(app, String(payment?.provider ?? ""))?.watch;
  if (watch) await sync(app, id).catch((e) => console.error("fin.payment sync", id, e));
  const shown = await slip(app, id);
  if (!shown) {
    if (watch && payment?.return_url) return new Redirect(String(payment.return_url));
    return new Output("Not Found", { status: 404 });
  }
  return new Output(String(html`<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
${watch ? html`<meta http-equiv="refresh" content="10">` : ""}
${html.raw(shown)}`), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
