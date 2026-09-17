import { uid } from "@qino/qino";

import type { App } from "@qino/qino";

/** A random path robots.txt disallows and nothing links to: whoever asks for it ignored robots.txt.
 *  New at every start; a bot holding an older robots.txt just is not caught. */
export function robotsHoneypot(app: App, signal: AbortSignal): void {
  const trap = uid(8) + "/";
  app.on("route", ({ ctx }) => {
    if (ctx.req.appPath.startsWith(trap)) app.fire("suspicious", { ctx, weight: 10, reason: "robots.txt honeypot" }).catch(() => {});
  }, { signal });
  app.on("seo:robots", ({ ctx, lines }) => { lines.push(`Disallow: ${ctx.req.appUrl}${trap}`); }, { signal });
}
