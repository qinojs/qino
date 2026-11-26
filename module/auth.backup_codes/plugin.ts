import { Access, s } from "@qino/qino";

import { generate, left, spend } from "./mod.ts";

import type { ApiTree, Params, Ctx } from "@qino/qino";
import type { Factor } from "@qino/qino/auth";

export const authFactors: Factor[] = [{
  name: "backup_codes",
  label: "Backup codes",
  second: true, // never the only one: a code alone is no way into an account
  stepUp: true,
  order: 90, // the way out when nothing else is at hand, so never the first offer
  has: async (app, usrId) => await left(app, usrId) > 0,
}];

export const api: ApiTree = {
  get: {
    description: "How many of the current user's backup codes are still unspent",
    access: Access.USER,
    execute: async (_: unknown, ctx: Ctx) => {
      return { left: await left(ctx.app, ctx.userId) };
    },
  },

  generate: {
    post: {
      description: "Replace the backup codes with a fresh set — shown this once and never again",
      access: Access.USER,
      requireStepUp: true,
      execute: async (_: unknown, ctx: Ctx) => ({ codes: await generate(ctx) }),
    },
  },

  verify: {
    post: {
      description: "Spend one backup code to prove the current user is present",
      access: Access.IDENTIFIED, // also the second factor of a login under way
      input: s.object({ code: s.string() }),
      execute: async ({ code }: Params, ctx: Ctx) => {
        return { ok: await spend(ctx, String(code)), left: await left(ctx.app, ctx.userId) };
      },
    },
  },
};
