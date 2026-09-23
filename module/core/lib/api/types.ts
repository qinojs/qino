import type { Ctx } from "../ctx/Ctx.ts";
import type { StandardSchema } from "../StandardSchema.ts";

export type Params = Record<string, unknown>;

export interface Verb {
  description?: string;
  input?: StandardSchema;
  query?: StandardSchema;
  output?: StandardSchema;
  /** Who may use this at all (without params). Checked for listings and every call. */
  access?: (ctx: Ctx) => boolean | Promise<boolean>;
  /** Check per call, after `access`, with path params, validated input and query (not in a dry
   *  run, which has no input). */
  guard?: (params: Params, ctx: Ctx) => boolean | Promise<boolean>;
  /** Always requires a fresh identity proof (e.g. when adding a factor). Declared, so listings see
   *  it. If it depends on the call, use `requireStepUp(ctx)` in `guard`. */
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
