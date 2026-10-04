import { Access, s } from "@qino/qino";

import { record } from "./mod.ts";

import type { ApiTree, Ctx, Params } from "@qino/qino";

export const api: ApiTree = { datapoint: { ":datapoint": {
  paramSchema: s.number(),
  post: {
    access: Access.USER,
    description: "Store one typed observation for a selected datapoint; time is Unix milliseconds and null represents missing data",
    input: s.object({ time: s.number(), value: s.any() }),
    execute: async ({ datapoint, time, value }: Params, ctx: Ctx) => {
      await record(ctx.app, Number(datapoint), value as number | null, Number(time));
      return { ok: true };
    },
  },
} } };
