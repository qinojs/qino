import { hee, mainContact } from "@qino/qino";

import { servePixel, trackHit } from "./lib/track.ts";
import { placeholder, serveUnsubscribe } from "./lib/unsubscribe.ts";
import { outbox } from "./mod.ts";

import type { App } from "@qino/qino";
import type { Jobs } from "@qino/qino/cron";
import type { Placeholder } from "./mod.ts";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

// What is owed goes out here: held back until something released it, or waiting after a failure of ours.
export const cron = {
  outbox: { every: 60, timeout: 120, run: (app: App) => outbox(app) },
} satisfies Jobs;

/** Every placeholder a message may name — what a template reads, and all any module has to
 *  look at to know what is on offer. Another module adds its own the same way. */
/** A contact of the recipient — looked up only where a template really names it. */
const contact = (type: string): Placeholder => async (app, to) => {
  const usrId = Number(to.usrId);
  const row = usrId ? await mainContact(app.db, usrId, type) : undefined;
  return row ? { text: String(row.address), html: hee(row.address) } : undefined;
};

export const messagingPlaceholders: Record<string, Placeholder> = {
  ...columns({ givenName: "given_name", familyName: "family_name", organization: "organization", address: "address" }),
  email: contact("email"),
  unsubscribe: placeholder,
};

/** A field of the recipient, as it stands in text and escaped in markup. The name a template
 *  writes is camelCase, the column it reads is the column. */
function columns(names: Record<string, string>): Record<string, Placeholder> {
  return Object.fromEntries(Object.entries(names).map(([name, column]) => [name, (_app, to) => {
    const value = String(to[column] ?? "");
    return Promise.resolve(value ? { text: value, html: hee(value) } : undefined);
  }]));
}

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  app.on("route", ({ ctx }) => (servePixel(ctx), serveUnsubscribe(ctx)), { signal });
  app.on("shorturl:hit", (hit) => trackHit(app, hit), { signal });
}
