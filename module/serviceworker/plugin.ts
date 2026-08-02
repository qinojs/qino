import { Output, type App, type Ctx } from "../core/mod.ts";

export const name = "serviceworker";
export const description = "Serves the app's single service worker, assembled from the parts other modules declare.";
export const needs = ["core"];

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  app.on("route", ({ ctx }) => { if (ctx.req.appPath === "sw.js") serve(ctx); }, { signal });
  app.on("html-ready", ({ ctx }) => register(ctx), { signal });
}

/** Modules that declare `export const serviceWorker = true` and are currently linked. */
function parts(app: App): string[] {
  return Object.values(app.modules.all())
    .filter((mod) => mod.plugin.serviceWorker && app.modules.linked(mod.name))
    .map((mod) => mod.name);
}

/** The worker is nothing but imports — every behaviour comes from a module's part. */
function serve(ctx: Ctx): void {
  const modules = parts(ctx.app);
  if (!modules.length) return; // no part, no worker
  const script = modules.map((m) => `import ${JSON.stringify(`${ctx.req.modulePath + m}/pub/sw.js`)};\n`).join("");
  throw new Output(script, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-cache", // the update check must see changed parts
    },
  });
}

function register(ctx: Ctx): void {
  if (!parts(ctx.app).length) return;
  ctx.res.html.scripts.add(ctx.req.modulePath + "serviceworker/pub/register.js");
}
