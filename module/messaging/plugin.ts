import { mainContact } from "@qino/qino";

import { servePixel, trackHit } from "./lib/track.ts";
import { placeholder, serveUnsubscribe } from "./lib/unsubscribe.ts";
import { outbox } from "./mod.ts";

import type { App } from "@qino/qino";
import type { Jobs } from "@qino/qino/cron";
import type { Placeholder } from "./mod.ts";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

// Sends due deliveries: released ones, and retries after our own failures.
export const cron = {
  outbox: { every: 60, timeout: 120, run: (app: App) => outbox(app) },
} satisfies Jobs;

/** A contact of the recipient — looked up only if a template uses it. */
const contact = (type: string): Placeholder => async (app, to) => {
  const usrId = Number(to.usrId);
  const row = usrId ? await mainContact(app.db, usrId, type) : undefined;
  return row ? { text: String(row.address) } : undefined;
};

/** Messaging's template placeholders. Other modules add theirs the same way. */
export const templatePlaceholders: Record<string, Placeholder> = {
  ...columns({ givenName: "given_name", familyName: "family_name", organization: "organization", address: "address" }),
  email: contact("email"),
  unsubscribe: placeholder,
};

/** A recipient column as placeholder (escaped in markup). Template name camelCase, column as is. */
function columns(names: Record<string, string>): Record<string, Placeholder> {
  return Object.fromEntries(Object.entries(names).map(([name, column]) => [name, (_app, to) => {
    const value = String(to[column] ?? "");
    return Promise.resolve(value ? { text: value } : undefined);
  }]));
}

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  app.on("route", ({ ctx }) => (servePixel(ctx), serveUnsubscribe(ctx)), { signal });
  app.on("shorturl:hit", (hit) => trackHit(app, hit), { signal });
}
