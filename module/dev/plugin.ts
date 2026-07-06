import type { App } from "../core/mod.ts";

export const name = "dev";
export const needs = ["core"];

/** Dev helpers — registers nothing unless the app runs with `dev: true`. */
export function init(app: App): void {
  //if (!app.dev) return;

  // request duration on every response (pages, api, static, dbFile) — visible in the browser devtools network panel
  app.on("response-ready", ({ req, res }) => {
    const dur = (performance.now() - req.time).toFixed(1);
    res.headers.set("Server-Timing", `app;dur=${dur}`);
    console.log(`${req.method} ${req.path} ${dur}ms`);
  });
}
