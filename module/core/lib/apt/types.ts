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
  /** Per-call check (param-aware): is this concrete call allowed. Evaluated on invoke, after access. */
  guard?: (params: Params, ctx: Ctx) => boolean | Promise<boolean>;
  execute(params: Params, ctx: Ctx): unknown | Promise<unknown>;
}

export interface AptNode {
  resolve?(raw: unknown, ctx: Ctx, parents: Params): unknown | Promise<unknown>;
  paramSchema?: StandardSchema;
  get?: Verb;
  post?: Verb;
  put?: Verb;
  delete?: Verb;
  patch?: Verb;
  [child: string]: unknown;
}

export type AptTree = Record<string, AptNode>;

/** A tree level while walking: any object is a possible branch. */
export type Branch = Record<string, unknown>;
export const branch = (v: unknown): Branch | undefined => v && typeof v === "object" ? v as Branch : undefined;

export const VERBS = ["get", "post", "put", "delete", "patch"] as const;
export type Method = typeof VERBS[number];
export const VERB_SET = new Set<string>(VERBS);
export const RESERVED: Set<string> = new Set(["resolve", ...VERBS]);
export const BODY_METHODS = new Set<Method>(["post", "put", "patch"]);
