import type { Verb } from "./types.ts";

/** Static admissibility gates for `Verb.access` (param-free). Per-call refinement goes in `Verb.guard`. */
export const Access: Record<"PUBLIC" | "USER" | "SUPERUSER", NonNullable<Verb["access"]>> = {
  PUBLIC:    () => true,
  USER:      (ctx) => ctx.user !== null,
  SUPERUSER: (ctx) => ctx.user?.get("superuser").then(Boolean) ?? Promise.resolve(false),
};
