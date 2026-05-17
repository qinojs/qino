import type { Params, Verb } from "./types.ts";

export const staticAccessKey = Symbol("staticAccess");

function staticAccess(fn: NonNullable<Verb["access"]>) {
  return Object.assign(fn, { [staticAccessKey]: true as const });
}

export function isStaticAccess(fn: NonNullable<Verb["access"]>): boolean {
  return (fn as unknown as Record<PropertyKey, unknown>)[staticAccessKey] === true;
}

export const Access = {
  PUBLIC:    staticAccess(() => true),
  USER:      staticAccess((_: Params, ctx) => ctx.user !== null),
  SUPERUSER: staticAccess((_: Params, ctx) => ctx.user?.get?.("superuser").then(Boolean) ?? Promise.resolve(false)),
} satisfies Record<string, NonNullable<Verb["access"]>>;
