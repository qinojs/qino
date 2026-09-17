import type { App } from "@qino/qino";

const TRAP = "admin-backup/";

/** A path robots.txt disallows and nothing links to: whoever asks for it ignored robots.txt. */
export function robotsHoneypot(app: App, signal: AbortSignal): void {
  app.on("route", async ({ ctx }) => {
    if (ctx.req.appPath.startsWith(TRAP)) await app.fire("suspicious", { ctx, weight: 3, reason: "robots.txt honeypot" });
  }, { signal });
  app.on("seo:robots", ({ ctx, lines }) => { lines.push(`Disallow: ${ctx.req.appUrl}${TRAP}`); }, { signal });
}
