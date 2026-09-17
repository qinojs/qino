import { clientIp } from "@qino/qino";

import { gate, load, suspect } from "./lib/guard.ts";
import { robotsHoneypot } from "./lib/robotsHoneypot.ts";
import { foreignPaths, suspiciousPaths } from "./lib/pathReports.ts";

import type { App } from "@qino/qino";

export const settingsSchema = {
  properties: {
    foreignPaths: { type: "boolean", default: true, description: "Count 404s on paths of other systems (*.php, wp-admin, js/). Turn off for a while after replacing an old site." },
  },
};

export async function init(app: App, { signal }: { signal: AbortSignal }): Promise<void> {
  await load(app);
  app.on("suspicious", ({ ctx, weight = 1, reason = "" }) => suspect(ctx, weight, reason), { signal });
  app.on("request-start", ({ request, peerAddr }) => gate(app, clientIp(request, peerAddr, app.trustedProxyHops)), { signal });

  robotsHoneypot(app, signal);
  suspiciousPaths(app, signal);
  foreignPaths(app, signal);
}
