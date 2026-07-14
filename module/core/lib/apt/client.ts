import { asParams, invoke } from "./invoke.ts";
import { isCatchall } from "./route.ts";
import { VERB_SET, type AptTree, type Method, type Params } from "./types.ts";

export type AptProxy ={ [key: string]: AptProxy } & ((...args: unknown[]) => AptProxy) & { [K in Method]: (params?: Params) => Promise<unknown> };

type Branch = Record<string, unknown>;
const branch = (v: unknown) => v && typeof v === "object" ? v as Branch : undefined;

export function aptClient(tree: AptTree) {
  function buildProxy(node: Branch, pathSoFar: string[]): AptProxy {
    const target = function () {} as unknown as AptProxy;
    return new Proxy(target, {
      get(_t, prop: string | symbol) {
        if (typeof prop !== "string" || prop === "then") return;
        const catchall = Object.keys(node).find(isCatchall);
        if (VERB_SET.has(prop) && (
          typeof branch(node[prop])?.execute === "function" ||
          typeof branch(branch(node[catchall ?? ""])?.[prop])?.execute === "function"
        )) {
          return (body?: unknown, query?: unknown) =>
            invoke(tree, prop, "/" + pathSoFar.join("/"), {
              input: asParams(body),
              query: asParams(query),
            });
        }
        const child = branch(node[prop]);
        if (!child) return;
        return buildProxy(child, [...pathSoFar, prop]);
      },
      apply(_t, _thisArg, args: unknown[]) {
        const paramKey = Object.keys(node).find((k) => k.startsWith(":"));
        if (!paramKey) throw new Error(`apt rpc: no :param under /${pathSoFar.join("/")}`);
        const vals = isCatchall(paramKey) ? args.flatMap((v) => Array.isArray(v) ? v : [v]) : [args[0]];
        return buildProxy(branch(node[paramKey]) ?? {}, [...pathSoFar, ...vals.map((v) => encodeURIComponent(String(v)))]);
      },
    });
  }
  return buildProxy(tree, []);
}
