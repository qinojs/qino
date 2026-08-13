import { RESERVED, VERBS } from "./types.ts";

import type { StandardSchema } from "../StandardSchema.ts";
import type { ApiNode, ApiTree, Method, Verb } from "./types.ts";

export interface Route {
  method: Method;
  segments: string[];
  nodes: ApiNode[];
  verb: Verb;
  name: string;
}

export const shapeOf = (schema?: StandardSchema): Record<string, StandardSchema> => schema?.shape ?? {};
export const isCatchall = (seg: string) => isParam(seg) && seg.endsWith("*");
export const paramName = (seg: string) => seg.slice(1).replace(/\*$/, "");

const isParam = (seg: string) => seg.startsWith(":");

export function routeParams(r: Route): [string, StandardSchema | undefined, string][] {
  return r.segments.flatMap((seg, i) =>
    isParam(seg) ? [[paramName(seg), r.nodes[i]?.paramSchema, seg] as [string, StandardSchema | undefined, string]] : []
  );
}

export function* walk(tree: ApiTree, segments: string[] = [], nodes: ApiNode[] = []): Generator<Route> {
  for (const [key, value] of Object.entries(tree)) {
    if (RESERVED.has(key) || value == null || typeof value !== "object") continue;
    for (const verbKey of VERBS) {
      const verb = value[verbKey];
      if (verb && typeof verb === "object" && typeof verb.execute === "function") {
        yield { method: verbKey, segments: [...segments, key], nodes: [...nodes, value], verb, name: camelName(verbKey, [...segments, key]) };
      }
    }
    yield* walk(value as ApiTree, [...segments, key], [...nodes, value]);
  }
}

export function camelName(verb: Method, segments: string[]): string {
  const parts = [verb, ...segments.flatMap((s) => isCatchall(s) ? paramName(s) : isParam(s) ? [] : [s])];
  // separators become camelCase; before a digit there is nothing to upcase, so they just vanish
  // ("cms.frontend.2" → "cmsFrontend2") — a leftover dot is no legal tool name for MCP clients.
  return parts.map((p) => p.replace(/[-.]([a-z])?/g, (_, c) => c ? c.toUpperCase() : "")).join("_");
}

export function checkCollisions(r: Route) {
  const seen = new Map<string, string>();
  const add = (name: string, source: string) => {
    if (seen.has(name)) throw new Error(
      `api setup error at ${r.method.toUpperCase()} /${r.segments.join("/")}: ` +
      `param name "${name}" appears in both ${seen.get(name)} and ${source} — rename one`,
    );
    seen.set(name, source);
  };
  for (const [name] of routeParams(r)) add(name, "path");
  for (const k of Object.keys(shapeOf(r.verb.input))) add(k, "input");
  for (const k of Object.keys(shapeOf(r.verb.query))) add(k, "query");
}
