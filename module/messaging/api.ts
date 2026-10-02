import { Access, ApiError, NotFoundError, s } from "@qino/qino";

import { channel, channels } from "./mod.ts";

import type { ApiTree, Ctx, Params } from "@qino/qino";
import type { Msg, To } from "./mod.ts";

export const api: ApiTree = {
  channels: {
    get: {
      description: "List available messaging channels",
      access: Access.USER,
      execute: (_: Params, ctx: Ctx) => channels(ctx.app).map(({ name, label, color, contact }) => ({ name, label, color, contact })),
    },
    ":channel": {
      paramSchema: s.string().describe("Channel name"),
      send: {
        post: {
          description: "Send a message to recipients resolved by the channel; returns the number of destinations reached",
          access: Access.SUPERUSER,
          input: s.object({
            to: s.object({
              usr: s.optional(s.any()).describe("User ID or array of user IDs"),
              grp: s.optional(s.number()).describe("Group ID"),
            }).describe("Recipients"),
            msg: s.any().describe("Text or { text, title?, format?: md|html, template?, attachments?, ...channel fields }"),
          }),
          execute: ({ channel: name, to, msg }: Params, ctx: Ctx) => {
            const { usr, grp } = to as To;
            const ids = [usr ?? [], grp ?? []].flat();
            if (!ids.length || ids.some((id) => !Number.isSafeInteger(id) || id <= 0))
              throw new ApiError(400, "Expected a user or group as positive integer IDs");
            const selected = channel(ctx.app, String(name));
            if (!selected) throw new NotFoundError("Channel is not available");
            return selected.send(ctx.app, to as To, msg as string | Msg);
          },
        },
      },
    },
  },
};
