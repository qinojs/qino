import type { App } from "../core/mod.ts";

export const name = "dev";
export const needs = ["core"];

/** Dev helpers — registers nothing unless the app runs with `dev: true`. */
export function init(app: App): void {
    //if (!app.dev) return;

    // request duration on every response (pages, api, static, dbFile) — visible in the browser devtools network panel
    app.on("response-ready", ({ ctx, res }) => {
        res.headers.set("Server-Timing", `app;dur=${(performance.now() - ctx.req.time).toFixed(1)}`);
    });
}
