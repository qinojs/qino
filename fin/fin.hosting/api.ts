import { Access, s } from "@qino/qino";
import { visible, whose, WHOSE } from "@qino/qino/fin";

import { domains, get, link, remove, save, subscriptionsBy, unlink } from "./mod.ts";

import type { ApiTree, Ctx, Params, Row } from "@qino/qino";

const VALUES = {
  usrId: s.optional(s.number().describe("Whose it is")),
  aliasOf: s.optional(s.string().describe("The domain it is an alias of; empty: none")),
  registrar: s.optional(s.string()),
};

/** A user reads their own domains; keeping them is a superuser's. */
export const api: ApiTree = {
  domains: {
    get: {
      description: "Domains, each with the subscriptions it is billed by (`subscriptions`): one's own; "
        + "a superuser asks for another's or all",
      access: Access.USER,
      query: s.object(WHOSE),
      execute: async ({ usrId, all }: Params, ctx: Ctx) => {
        const owner = whose(ctx, { usrId, all });
        const subs = await subscriptionsBy(ctx.app, owner);
        return (await domains(ctx.app, owner)).map((d) => ({ ...d, subscriptions: subs.get(String(d.name)) ?? [] }));
      },
    },
    post: {
      description: "Add a domain, or change one: owner, alias, registrar; its name comes back",
      access: Access.SUPERUSER,
      input: s.object({ name: s.string().describe("example.ch"), ...VALUES }),
      execute: ({ name, ...values }: Params, ctx: Ctx) => save(ctx.app, String(name), values as Parameters<typeof save>[2]),
    },
  },

  domain: {
    ":domain": {
      paramSchema: s.string().describe("The domain: example.ch"),
      resolve: async (name: string, ctx: Ctx) => visible(ctx, await get(ctx.app, name), `domain ${name}`),
      get: {
        description: "One domain with the subscriptions it is billed by",
        access: Access.USER,
        execute: async ({ domain }: Params, ctx: Ctx) => {
          const d = domain as Row;
          return { ...d, subscriptions: (await subscriptionsBy(ctx.app, Number(d.usr_id) || undefined)).get(String(d.name)) ?? [] };
        },
      },
      delete: {
        description: "Remove it — refused while it has aliases, running subscriptions or unpaid invoices",
        access: Access.SUPERUSER,
        execute: async ({ domain }: Params, ctx: Ctx) => {
          await remove(ctx.app, String((domain as Row).name));
          return { ok: true };
        },
      },
      link: {
        post: {
          description: "Bill a subscription of the domain's owner for it",
          access: Access.SUPERUSER,
          input: s.object({ subscription: s.number() }),
          execute: async ({ domain, subscription }: Params, ctx: Ctx) => {
            await link(ctx.app, String((domain as Row).name), Number(subscription));
            return { ok: true };
          },
        },
      },
      unlink: {
        post: {
          description: "The subscription is for no domain any more",
          access: Access.SUPERUSER,
          input: s.object({ subscription: s.number() }),
          execute: async ({ subscription }: Params, ctx: Ctx) => {
            await unlink(ctx.app, Number(subscription));
            return { ok: true };
          },
        },
      },
    },
  },
};
