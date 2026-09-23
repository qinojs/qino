import { uid } from "@qino/qino";

import type { App } from "@qino/qino";

/** A random path disallowed in robots.txt and never linked: requesting it means robots.txt was
 *  ignored. New on every start. */
export function robotsHoneypot(app: App, signal: AbortSignal): void {
  const trap = uid(8) + "/";
  app.on("route", ({ ctx }) => {
    if (ctx.req.appPath.startsWith(trap)) app.fire("suspicious", { ctx, weight: 10, reason: "robots.txt honeypot" }).catch(() => {});
  }, { signal });
  app.on("seo:robots", ({ ctx, lines }) => { lines.push(`Disallow: ${ctx.req.appUrl}${trap}`); }, { signal });
}
