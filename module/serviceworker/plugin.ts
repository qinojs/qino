import { Output, sha256, type App, type Ctx } from "../core/mod.ts";

export const name = "serviceworker";
export const description = "Serves the app's single service worker, assembled from the parts other modules declare.";
export const needs = ["core"];

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  app.on("route", ({ ctx }) => ctx.req.appPath === "sw.js" ? serve(ctx) : undefined, { signal });
  app.on("html-ready", ({ ctx }) => register(ctx), { signal });
}

/** Modules that declare `export const serviceWorker = true` and are currently linked. */
const parts = (app: App) =>
  Object.values(app.modules.all()).filter((mod) => mod.plugin.serviceWorker && app.modules.linked(mod.name));

/** The worker is nothing but imports — every behaviour comes from a module's part. */
async function serve(ctx: Ctx): Promise<void> {
  const modules = parts(ctx.app);
  if (!modules.length) return; // no part, no worker
  const script = modules.map((m) => `import ${JSON.stringify(`${ctx.req.modulePath + m.name}/pub/sw.js`)};\n`).join("");
  // "no-cache" stores the worker but revalidates it; the ETag then answers most checks with a 304
  const headers = {
    "Content-Type": "text/javascript; charset=utf-8",
    "Cache-Control": "no-cache",
    ETag: `W/"${await sha256(script)}"`,
  };
  if (ctx.req.header("if-none-match") === headers.ETag) throw new Output(undefined, { status: 304, headers });
  throw new Output(script, { headers });
}

// runs on every rendered page — short-circuits on the first part instead of collecting them
function register(ctx: Ctx): void {
  const app = ctx.app;
  if (!Object.values(app.modules.all()).some((mod) => mod.plugin.serviceWorker && app.modules.linked(mod.name))) return;
  ctx.res.html.scripts.add(ctx.req.modulePath + "serviceworker/pub/register.js");
}
