import { identified } from "../auth/factors.ts";

import type { Verb } from "./types.ts";

/** Levels for `Verb.access` (without params); per-call checks go in `Verb.guard`.
 *  `IDENTIFIED` = `USER` plus a pending login (the second factor comes before sign-in). */
export const Access: Record<"PUBLIC" | "IDENTIFIED" | "USER" | "SUPERUSER", NonNullable<Verb["access"]>> = {
  PUBLIC:     () => true,
  IDENTIFIED: (ctx) => !!identified(ctx),
  USER:       (ctx) => ctx.user !== null,
  SUPERUSER:  (ctx) => !!ctx.user?.superuser,
};
