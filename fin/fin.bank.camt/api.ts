import { Access, s } from "@qino/qino";

import { ingest } from "./mod.ts";

import type { ApiTree, Ctx, Params } from "@qino/qino";

/** Reading statements in is a superuser's. */
export const api: ApiTree = {
  post: {
    description: "Read a camt.053 statement or camt.054 notification; lines seen before are skipped",
    access: Access.SUPERUSER,
    input: s.object({ xml: s.string() }),
    execute: ({ xml }: Params, ctx: Ctx) => ingest(ctx.app, String(xml)),
  },
};
