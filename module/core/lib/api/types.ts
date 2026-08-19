import type { Ctx } from "../ctx/Ctx.ts";
import type { StandardSchema } from "../StandardSchema.ts";

export type Params = Record<string, unknown>;

export interface Verb {
  description?: string;
  input?: StandardSchema;
  query?: StandardSchema;
  output?: StandardSchema;
  /** Static admissibility gate (param-free): who may use this at all. Evaluated for listings and on every call. */
  access?: (ctx: Ctx) => boolean | Promise<boolean>;
  /** Per-call check: is this concrete call allowed. Runs after `access` on the resolved path params
   *  plus the validated input and query — except in a dry run, which has no input to show it. */
  guard?: (params: Params, ctx: Ctx) => boolean | Promise<boolean>;
  /** Always demands a fresh proof of identity (issuing a factor, say). Declared rather than called,
   *  so a listing can see it and it cannot come too late. Where it depends on the call, call
   *  `requireStepUp(ctx)` in a `guard`. */
  requireStepUp?: boolean | { maxAge: number };
  execute(params: Params, ctx: Ctx): unknown | Promise<unknown>;
}

export interface ApiNode {
  resolve?(raw: unknown, ctx: Ctx, parents: Params): unknown | Promise<unknown>;
  paramSchema?: StandardSchema;
  get?: Verb;
  post?: Verb;
  put?: Verb;
  delete?: Verb;
  patch?: Verb;
  [child: string]: unknown;
}

export type ApiTree = Record<string, ApiNode>;

/** A tree level while walking: any object is a possible branch. */
export type Branch = Record<string, unknown>;
export const branch = (v: unknown): Branch | undefined => v && typeof v === "object" ? v as Branch : undefined;

export const VERBS = ["get", "post", "put", "delete", "patch"] as const;
export type Method = typeof VERBS[number];
export const VERB_SET = new Set<string>(VERBS);
export const RESERVED = new Set<string>(["resolve", ...VERBS]);
export const BODY_METHODS = new Set<Method>(["post", "put", "patch"]);
