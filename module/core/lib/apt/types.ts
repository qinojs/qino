import type { RequestContext } from "../RequestContext.ts";
import type { StandardSchema } from "../StandardSchema.ts";

export type Params = Record<string, unknown>;

export interface Verb {
  description?: string;
  input?: StandardSchema;
  query?: StandardSchema;
  output?: StandardSchema;
  access?: (params: Params, ctx: RequestContext) => boolean | Promise<boolean>;
  execute(params: Params, ctx: RequestContext): unknown | Promise<unknown>;
}

export interface AptNode {
  resolve?(raw: unknown, ctx: RequestContext, parents: Params): unknown | Promise<unknown>;
  paramSchema?: StandardSchema;
  get?: Verb;
  post?: Verb;
  put?: Verb;
  delete?: Verb;
  patch?: Verb;
  [child: string]: unknown;
}

export type AptTree = Record<string, AptNode>;

export const VERBS = ["get", "post", "put", "delete", "patch"] as const;
export type Method = typeof VERBS[number];
export const VERB_SET: Set<string> = new Set(VERBS);
export const RESERVED: Set<string> = new Set(["resolve", ...VERBS]);
export const BODY_METHODS: Set<Method> = new Set(["post", "put", "patch"]);
