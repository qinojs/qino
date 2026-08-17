import { Access, getCtx, s } from "@qino/qino";
import { channels } from "@qino/qino/messaging";

import { send, verify } from "./mod.ts";

import type { ApiTree, App, Params } from "@qino/qino";
import type { Factor } from "@qino/qino/auth";

/**
 * One factor per messaging channel, derived rather than listed: a channel that can reach a person
 * can carry a code to them, and `reach()` is already the question `has()` asks.
 *
 * No `login` yet — a code can only be requested for a user the request already knows, which a login
 * does not until it can ask for a second factor.
 */
export const authFactors = (app: App): Factor[] =>
  channels(app).map((c) => ({
    name: c.name,
    label: `${c.label} code`,
    stepUp: true,
    has: async (app: App, usrId: number) => await c.reach(app, usrId) > 0,
  }));

export const api: ApiTree = {
  ":channel": {
    paramSchema: s.string(),
    post: {
      description: "Send a one-time code over this channel",
      access: Access.USER,
      execute: async ({ channel }: Params) => {
        await send(getCtx(), String(channel));
        return { ok: true };
      },
    },
    verify: {
      post: {
        description: "Prove the current user is present with the code that was sent",
        access: Access.USER,
        input: s.object({ code: s.string() }),
        execute: async ({ channel, code }: Params) => ({ ok: await verify(getCtx(), String(channel), String(code)) }),
      },
    },
  },
};
