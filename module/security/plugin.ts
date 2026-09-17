import { clientIp } from "@qino/qino";

import { gate, start, suspect } from "./lib/guard.ts";
import { robotsHoneypot } from "./lib/robotsHoneypot.ts";

import type { App } from "@qino/qino";

export async function init(app: App, { signal }: { signal: AbortSignal }): Promise<void> {
  await start(app);
  app.on("suspicious", ({ ctx, weight = 1, reason = "" }) => suspect(ctx, weight, reason), { signal });
  app.on("request-start", ({ request, peerAddr }) => gate(app, clientIp(request, peerAddr, app.trustedProxyHops)), { signal });

  robotsHoneypot(app, signal);
}
