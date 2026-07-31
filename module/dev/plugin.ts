import type { App } from "../core/mod.ts";

export const name = "dev";
export const description = "Logs request durations and exposes them through Server-Timing headers.";
export const needs = ["core"];

/** Dev helpers */
export function init(app: App, { signal }: { signal: AbortSignal }): void {
  // request duration on every response (pages, api, static, dbFile) — visible in the browser devtools network panel
  app.on("response-ready", ({ request, res, time }) => {
    const dur = (performance.now() - time).toFixed(1);
    res.headers.set("Server-Timing", `app;dur=${dur}`);
    console.log(`${request.method} ${new URL(request.url).pathname} ${dur}ms`);
  }, { signal });
}
