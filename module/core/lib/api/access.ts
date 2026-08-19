import { identified } from "../auth/factors.ts";

import type { Verb } from "./types.ts";

/** Static admissibility gates for `Verb.access` (param-free). Per-call refinement goes in `Verb.guard`.
 *  `IDENTIFIED` is `USER` plus a login under way — a second factor is given before signing in. */
export const Access: Record<"PUBLIC" | "IDENTIFIED" | "USER" | "SUPERUSER", NonNullable<Verb["access"]>> = {
  PUBLIC:     () => true,
  IDENTIFIED: (ctx) => !!identified(ctx),
  USER:       (ctx) => ctx.user !== null,
  SUPERUSER:  (ctx) => !!ctx.user?.superuser,
};
