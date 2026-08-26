// deno-lint-ignore-file no-explicit-any
import { Access, getCtx, s, sha256b64url, sql, unixTime } from "@qino/qino";

import { publicKey } from "./mod.ts";

import type { ApiTree } from "@qino/qino";

export { messagingChannel } from "./mod.ts";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

export const settingsSchema = {
  properties: {
    subject: { type: "string", default: "mailto:admin@localhost", description: "VAPID contact the push service can reach you at — mailto: or https: URL" },
    publicKey: { type: "string", description: "VAPID public key — generated on first use" },
    privateKey: { type: "string", description: "VAPID private key — generated on first use" },
  },
};

export const api: ApiTree = {

  key: {
    get: {
      description: "VAPID public key for pushManager.subscribe()",
      access: Access.PUBLIC,
      execute: async () => ({ publicKey: (await publicKey(getCtx().app)).publicKey }),
    },
  },

  subscription: {
    get: {
      description: "Read the channels this browser is subscribed to",
      access: Access.PUBLIC,
      input: s.object({ endpoint: s.string() }),
      execute: async ({ endpoint }: any) => {
        const db = getCtx().app.db;
        const rows = await db.query`SELECT c.name FROM webpush_subscription_channel sc
          JOIN webpush_channel c ON c.id = sc.channel_id
          JOIN webpush_subscription s ON s.id = sc.sub_id
          WHERE s.endpoint_hash = ${await sha256b64url(endpoint)}`;
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
        const table = db.table("webpush_subscription");
        // endpoints are too long to index; their hash is the subscription's identity
        const endpoint_hash = await sha256b64url(endpoint);
        const values = { usr_id: ctx.userId || null, client_id: ctx.clientId, endpoint, endpoint_hash, p256dh, auth };
        // the same browser re-subscribes with the same endpoint — adopt it instead of duplicating
        const known = await db.one`SELECT id FROM webpush_subscription WHERE endpoint_hash = ${endpoint_hash}`;
        const id = known ? (await table.update(known, values), known) : await table.insert({ ...values, created: unixTime() });

        if (channels) {
          // the posted list is the whole truth for this browser; names the backend does not know are ignored
          const wanted = [...new Set(channels as string[])];
          const found = await db.query`SELECT id FROM webpush_channel WHERE ${sql.in("name", wanted)}`;
          const link = db.table("webpush_subscription_channel");
          await db.exec`DELETE FROM webpush_subscription_channel WHERE sub_id = ${id}`;
          await Promise.all(found.map((c) => link.insert({ sub_id: id, channel_id: c.id })));
        }
        return { ok: true };
      },
    },

    delete: {
      description: "Forget this browser's push subscription",
      access: Access.PUBLIC,
      input: s.object({ endpoint: s.string() }),
      execute: async ({ endpoint }: any) => {
        await getCtx().app.db.exec`DELETE FROM webpush_subscription WHERE endpoint_hash = ${await sha256b64url(endpoint)}`;
        return { ok: true };
      },
    },
  },

};
