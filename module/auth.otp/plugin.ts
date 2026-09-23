import { Access, getCtx, requestStorage, s } from "@qino/qino";
import { channels } from "@qino/qino/messaging";

import { send, verify } from "./mod.ts";

import type { ApiTree, App, Params } from "@qino/qino";
import type { Factor } from "@qino/qino/auth";

/**
 * One factor per messaging channel; `has()` uses the channel's `reach()`.
 *
 * `second`, because codes can only go to a user the request already knows.
 */
export const authFactors = (app: App): Factor[] =>
  channels(app).map((c) => ({
    name: c.name,
    label: `${c.label} code`,
    second: true,
    stepUp: true,
    order: 40,
    // the asking device is no second factor, so it does not count towards having one either
    has: async (app, usrId) => await c.reach(app, usrId, asking()) > 0,
  }));

/** The asking device, if called from a request (jobs may reach all devices). */
const asking = () => requestStorage.getStore()?.clientId ?? undefined;

export const api: ApiTree = {
  ":channel": {
    paramSchema: s.string(),
    post: {
      description: "Send a one-time code over this channel",
      access: Access.IDENTIFIED, // also to a login under way
      execute: async ({ channel }: Params) => {
        await send(getCtx(), String(channel));
        return { ok: true };
      },
    },
    verify: {
      post: {
        description: "Prove the current user is present with the code that was sent",
        access: Access.IDENTIFIED,
        input: s.object({ code: s.string() }),
        execute: async ({ channel, code }: Params) => ({ ok: await verify(getCtx(), String(channel), String(code)) }),
      },
    },
  },
};
