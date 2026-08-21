import { servePixel, trackHit } from "./lib/track.ts";
import { serveUnsubscribe } from "./lib/unsubscribe.ts";

import type { App } from "@qino/qino";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

export const settingsSchema = {
  properties: {
    _secret: { type: "string", description: "Key for verification code hashes and tracking markers — generated on first use" },
  },
};

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  app.on("route", ({ ctx }) => (servePixel(ctx), serveUnsubscribe(ctx)), { signal });
  app.on("shorturl:hit", (hit) => trackHit(app, hit), { signal });
}
