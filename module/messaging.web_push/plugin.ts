// deno-lint-ignore-file no-explicit-any
import dbSchema from "./dbschema.json" with { type: "json" };
import { Access, b64url, getCtx, s, unixTime, type AptTree } from "../core/mod.ts";
import { vapid } from "./mod.ts";

export const name = "messaging.web_push";
export const description = "Web Push — stores browser subscriptions and delivers notifications to them.";
export const needs = ["core", "serviceworker"];
export const serviceWorker = true; // pub/sw.js is imported into the app worker
export { dbSchema };

export const settingsSchema = {
  properties: {
    subject: { type: "string", description: "VAPID contact the push service can reach you at — mailto: or https: URL" },
    publicKey: { type: "string", description: "VAPID public key — generated on first use" },
    privateKey: { type: "string", description: "VAPID private key — generated on first use" },
  },
};

/** Endpoints are too long to index; their hash is the subscription's identity. */
const hashOf = async (endpoint: string): Promise<string> =>
  b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint))));

export const api: AptTree = {

  key: {
    get: {
      description: "VAPID public key for pushManager.subscribe()",
      access: Access.PUBLIC,
      execute: async () => ({ publicKey: (await vapid(getCtx().app)).publicKey }),
    },
  },

  subscription: {
    get: {
      description: "Read the channels this browser is subscribed to",
      access: Access.PUBLIC,
      input: s.object({ endpoint: s.string() }),
      execute: async ({ endpoint }: any) => {
        const db = getCtx().app.db;
        const rows = await db.query`SELECT c.name FROM web_push_subscription_channel sc
          JOIN web_push_channel c ON c.id = sc.channel_id
          JOIN web_push_subscription s ON s.id = sc.sub_id
          WHERE s.endpoint_hash = ${await hashOf(endpoint)}`;
        return { channels: rows.map((r) => r.name) };
      },
    },

    post: {
      description: "Store this browser's push subscription and its channels",
      access: Access.PUBLIC,
      input: s.object({ endpoint: s.string(), p256dh: s.string(), auth: s.string(), channels: s.optional(s.array(s.string())) }),
      execute: async ({ endpoint, p256dh, auth, channels }: any) => {
        const ctx = getCtx();
        const db = ctx.app.db;
        const table = db.table("web_push_subscription");
        const endpoint_hash = await hashOf(endpoint);
        const values = { usr_id: ctx.userId || null, client_id: ctx.clientId, endpoint, endpoint_hash, p256dh, auth };
        // the same browser re-subscribes with the same endpoint — adopt it instead of duplicating
        const known = await db.row`SELECT id FROM web_push_subscription WHERE endpoint_hash = ${endpoint_hash}`;
        const id = known ? (await table.update(known.id, values), known.id) : await table.insert({ ...values, created: unixTime() });

        if (channels) {
          // the posted list is the whole truth for this browser; names the backend does not know are ignored
          await db.exec`DELETE FROM web_push_subscription_channel WHERE sub_id = ${id}`;
          for (const name of new Set(channels as string[])) {
            const channel = await db.row`SELECT id FROM web_push_channel WHERE name = ${name}`;
            if (channel) await db.table("web_push_subscription_channel").insert({ sub_id: id, channel_id: channel.id });
          }
        }
        return { ok: true };
      },
    },

    delete: {
      description: "Forget this browser's push subscription",
      access: Access.PUBLIC,
      input: s.object({ endpoint: s.string() }),
      execute: async ({ endpoint }: any) => {
        const ctx = getCtx();
        await ctx.app.db.exec`DELETE FROM web_push_subscription WHERE endpoint_hash = ${await hashOf(endpoint)}`;
        return { ok: true };
      },
    },
  },

};
