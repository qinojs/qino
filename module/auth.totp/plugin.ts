import { Access, s } from "@qino/qino";
import { stored } from "@qino/qino/auth";

import { confirm, enrol, forget, verify } from "./mod.ts";

import type { ApiTree, App, Params, Ctx } from "@qino/qino";
import type { Factor } from "@qino/qino/auth";

export const authFactors: Factor[] = [{
  name: "totp",
  label: "Authenticator app",
  stepUp: true,
  order: 20,
  has: async (app: App, usrId: number) => !!(await stored(app, usrId, "totp")).length,
}];

export const api: ApiTree = {
  get: {
    description: "List the current user's authenticator apps",
    access: Access.USER,
    execute: async (_: unknown, ctx: Ctx) => {
      const rows = await stored(ctx.app, ctx.userId, "totp");
      return rows.map((r) => ({ id: r.id, label: r.label, created: r.created, lastUsed: r.last_used }));
    },
  },

  enrol: {
    post: {
      description: "Start setting up an authenticator app — returns the secret to scan",
      access: Access.USER,
      requireStepUp: true,
      execute: (_: unknown, ctx: Ctx) => enrol(ctx),
    },
    verify: {
      post: {
        description: "Finish setting up — the code proves the app holds the secret",
        access: Access.USER,
        requireStepUp: true,
        input: s.object({ code: s.string(), label: s.optional(s.string()) }),
        execute: async ({ code, label }: Params, ctx: Ctx) => {
          await confirm(ctx, String(code), String(label ?? ""));
          return { ok: true };
        },
      },
    },
  },

  verify: {
    post: {
      description: "Prove the current user is present with a code from their authenticator app",
      access: Access.IDENTIFIED, // also the second factor of a login under way
      input: s.object({ code: s.string() }),
      execute: async ({ code }: Params, ctx: Ctx) => ({ ok: await verify(ctx, String(code)) }),
    },
  },

  ":factor": {
    paramSchema: s.number(),
    delete: {
      description: "Remove one authenticator app",
      access: Access.USER,
      requireStepUp: true,
      execute: async ({ factor }: Params, ctx: Ctx) => {
        await forget(ctx, Number(factor));
        return { ok: true };
      },
    },
  },
};
