import type { StandardSchema } from "../StandardSchema.ts";
import { RESERVED, VERBS, type AptNode, type AptTree, type Method, type Verb } from "./types.ts";

export interface Route {
  method: Method;
  segments: string[];
  nodes: AptNode[];
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

export function* walk(tree: AptTree, segments: string[] = [], nodes: AptNode[] = []): Generator<Route> {
  for (const [key, value] of Object.entries(tree)) {
    if (RESERVED.has(key) || value == null || typeof value !== "object") continue;
    for (const verbKey of VERBS) {
      const verb = value[verbKey];
      if (verb && typeof verb === "object" && typeof verb.execute === "function") {
        yield { method: verbKey, segments: [...segments, key], nodes: [...nodes, value], verb, name: camelName(verbKey, [...segments, key]) };
      }
    }
    yield* walk(value as AptTree, [...segments, key], [...nodes, value]);
  }
}

export function camelName(verb: Method, segments: string[]): string {
  const parts = [verb, ...segments.flatMap((s) => isCatchall(s) ? paramName(s) : isParam(s) ? [] : [s])];
  return parts.map((p) => p.replace(/[-.]([a-z])/g, (_, c) => c.toUpperCase())).join("_");
}

export function checkCollisions(r: Route) {
  const seen = new Map<string, string>();
  const add = (name: string, source: string) => {
    if (seen.has(name)) throw new Error(
      `apt setup error at ${r.method.toUpperCase()} /${r.segments.join("/")}: ` +
      `param name "${name}" appears in both ${seen.get(name)} and ${source} — rename one`,
    );
    seen.set(name, source);
  };
  for (const [name] of routeParams(r)) add(name, "path");
  for (const k of Object.keys(shapeOf(r.verb.input))) add(k, "input");
  for (const k of Object.keys(shapeOf(r.verb.query))) add(k, "query");
}
