import { asParams, invoke } from "./invoke.ts";
import { isCatchall } from "./route.ts";
import { VERB_SET, branch } from "./types.ts";

import type { ApiTree, Branch, Method, Params } from "./types.ts";

export type ApiProxy ={ [key: string]: ApiProxy } & ((...args: unknown[]) => ApiProxy) & { [K in Method]: (params?: Params) => Promise<unknown> };


export function apiClient(tree: ApiTree) {
  function buildProxy(node: Branch, pathSoFar: string[]): ApiProxy {
    return new Proxy(function () {} as unknown as ApiProxy, {
      get(_t, prop: string | symbol) {
        if (typeof prop !== "string" || prop === "then") return;
        const c = branch(node[prop]);
        if (VERB_SET.has(prop) && (
          typeof c?.execute === "function" ||
          typeof branch(branch(node[Object.keys(node).find(isCatchall) ?? ""])?.[prop])?.execute === "function"
        )) {
          return (body?: unknown, query?: unknown) =>
            invoke(tree, prop, "/" + pathSoFar.join("/"), {
              input: asParams(body),
              query: asParams(query),
            });
        }
        if (!c) return;
        return buildProxy(c, [...pathSoFar, prop]);
      },
      apply(_t, _thisArg, args: unknown[]) {
        const paramKey = Object.keys(node).find((k) => k.startsWith(":"));
        if (!paramKey) throw new Error(`api rpc: no :param under /${pathSoFar.join("/")}`);
        const vals = isCatchall(paramKey) ? args.flat() : [args[0]];
        return buildProxy(branch(node[paramKey]) ?? {}, [...pathSoFar, ...vals.map((v) => encodeURIComponent(String(v)))]);
      },
    });
  }
  return buildProxy(tree, []);
}
