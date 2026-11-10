import { OrdersH005 } from "@kage0x3b/ebics-client";
import { Access, fs } from "@qino/qino";

import { clientOf, requireKeys, submit, trustBank } from "./client.ts";
import { config } from "./config.ts";

import type { ApiTree, Ctx } from "@qino/qino";

/** A connection that must be configured. */
async function connection(ctx: Ctx) {
  const c = await config(ctx.app);
  if (!c) throw new Error("fin.bank.ebics: no connection configured");
  return { c, client: await clientOf(c) };
}

/** The one-time enrolment, in this order: keys, ini, hia, then the bank activates the user, then hpb.
 *  All of it is a superuser's. */
export const api: ApiTree = {
  keys: {
    post: {
      description: "Create the three keys once; the fingerprints go in the bank's initialisation letter",
      access: Access.SUPERUSER,
      execute: async (_: unknown, ctx: Ctx) => {
        const { c, client } = await connection(ctx);
        if (await fs.stat(c.keyring, { ttl: 0 })) throw new Error("fin.bank.ebics: keyring exists; refusing to replace enrolment keys");
        const keys = await client.generateKeys({ subject: c.userId });
        const a = keys?.a(), x = keys?.x(), e = keys?.e();
        if (!a || !x || !e) throw new Error("fin.bank.ebics: key generation incomplete");
        return { partnerId: c.partnerId, userId: c.userId, A006: a.sha256(), X002: x.sha256(), E002: e.sha256() };
      },
    },
  },
  ini: {
    post: {
      description: "Send the signature key (INI)",
      access: Access.SUPERUSER,
      execute: async (_: unknown, ctx: Ctx) => {
        const { client } = await connection(ctx);
        await requireKeys(client);
        await submit(client, OrdersH005.INI);
      },
    },
  },
  hia: {
    post: {
      description: "Send the authentication and encryption keys (HIA)",
      access: Access.SUPERUSER,
      execute: async (_: unknown, ctx: Ctx) => {
        const { client } = await connection(ctx);
        await requireKeys(client);
        await submit(client, OrdersH005.HIA);
      },
    },
  },
  hpb: {
    post: {
      description: "Fetch the bank's keys (HPB) and store them if they match bankX002 and bankE002",
      access: Access.SUPERUSER,
      execute: async (_: unknown, ctx: Ctx) => {
        const { c, client } = await connection(ctx);
        await trustBank(client, c);
      },
    },
  },
};
