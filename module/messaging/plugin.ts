import { hee } from "@qino/qino";

import { servePixel, trackHit } from "./lib/track.ts";
import { placeholder, serveUnsubscribe } from "./lib/unsubscribe.ts";

import type { App } from "@qino/qino";
import type { Placeholder } from "./mod.ts";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

/** Every placeholder a message may name — what a template reads, and all any module has to
 *  look at to know what is on offer. Another module adds its own the same way. */
export const messagingPlaceholders: Record<string, Placeholder> = {
  ...columns({ givenName: "firstname", familyName: "lastname", company: "company", email: "email", address: "address" }),
  unsubscribe: placeholder,
};

/** A column of the recipient, as it stands in text and escaped in markup. The name a template
 *  writes is the standard one — `usr` still spells two of them the old way. */
function columns(names: Record<string, string>): Record<string, Placeholder> {
  return Object.fromEntries(Object.entries(names).map(([name, column]) => [name, (_app, to) => {
    const value = String(to[column] ?? "");
    return Promise.resolve(value ? { text: value, html: hee(value) } : undefined);
  }]));
}

export const settingsSchema = {
  properties: {
    _secret: { type: "string", description: "Key for verification code hashes and tracking markers — generated on first use" },
  },
};

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  app.on("route", ({ ctx }) => (servePixel(ctx), serveUnsubscribe(ctx)), { signal });
  app.on("shorturl:hit", (hit) => trackHit(app, hit), { signal });
}
