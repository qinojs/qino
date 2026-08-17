import { Access, getCtx, s } from "@qino/qino";
import { stored } from "@qino/qino/auth";

import { confirm, enrol, forget, verify } from "./mod.ts";

import type { ApiTree, App, Params } from "@qino/qino";
import type { Factor } from "@qino/qino/auth";

export const authFactors: Factor[] = [{
  name: "totp",
  label: "Authenticator app",
  login: true,
  requireStepUp: true,
  order: 20,
  has: async (app: App, usrId: number) => (await stored(app, usrId, "totp")).length > 0,
}];

export const api: ApiTree = {
  get: {
    description: "List the current user's authenticator apps",
    access: Access.USER,
    execute: async () => {
      const ctx = getCtx();
      const rows = await stored(ctx.app, ctx.userId, "totp");
      return rows.map((r) => ({ id: r.id, label: r.label, created: r.created, lastUsed: r.last_used }));
    },
  },

  enrol: {
    post: {
      description: "Start setting up an authenticator app — returns the secret to scan",
      access: Access.USER,
      requireStepUp: true,
      execute: () => enrol(getCtx()),
    },
    verify: {
      post: {
        description: "Finish setting up — the code proves the app holds the secret",
        access: Access.USER,
        requireStepUp: true,
        input: s.object({ code: s.string(), label: s.optional(s.string()) }),
        execute: async ({ code, label }: Params) => {
          await confirm(getCtx(), String(code), String(label ?? ""));
          return { ok: true };
        },
      },
    },
  },

  verify: {
    post: {
      description: "Prove the current user is present with a code from their authenticator app",
      access: Access.USER,
      input: s.object({ code: s.string() }),
      execute: async ({ code }: Params) => ({ ok: await verify(getCtx(), String(code)) }),
    },
  },

  ":factor": {
    paramSchema: s.number(),
    delete: {
      description: "Remove one authenticator app",
      access: Access.USER,
      requireStepUp: true,
      execute: async ({ factor }: Params) => {
        await forget(getCtx(), Number(factor));
        return { ok: true };
      },
    },
  },
};
