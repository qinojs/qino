import { toJsonSchema } from "../StandardSchema.ts";
import { isEmptyObject } from "../util.ts";
import { asParams, invoke } from "./invoke.ts";
import { checkCollisions, isCatchall, paramName, routeParams, shapeOf, walk } from "./route.ts";

import type { Ctx } from "../ctx/Ctx.ts";
import type { ApiTree, Method, Params } from "./types.ts";

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: unknown, ctx: Ctx): Promise<unknown>;
}

export function toTools(tree: ApiTree, opts: { apis?: Record<string, Method[]> } = {}): Tool[] {
  const tools: Tool[] = [], names = new Map<string, string>();
  for (const r of walk(tree)) {
    checkCollisions(r);
    const pathStr = "/" + r.segments.join("/");
    // path params are not in the name: the list and an item of it need names of their own (nodes, node/:node)
    const route = `${r.method.toUpperCase()} ${pathStr}`;
    if (names.has(r.name)) throw new Error(`api setup error: ${route} and ${names.get(r.name)} are both the tool "${r.name}" — rename one`);
    names.set(r.name, route);
    if (opts.apis && !opts.apis[pathStr]?.includes(r.method)) continue;

    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [name, paramSchema, seg] of routeParams(r)) {
      properties[name] = paramSchema ? toJsonSchema(paramSchema) : { type: "string" };
      if (!isCatchall(seg)) required.push(name);
    }
    for (const schema of [r.verb.input, r.verb.query]) {
      for (const [k, field] of Object.entries(shapeOf(schema))) {
        properties[k] = toJsonSchema(field);
        if (field.kind !== "optional" && field.defaultValue === undefined) required.push(k);
      }
    }

    tools.push({
      name: r.name,
      description: r.verb.description ?? r.name,
      parameters: isEmptyObject(properties) ? {} : { type: "object", properties, required },
      execute: (args) => {
        const raw = { ...asParams(args) };
        // zzz needed? for (const [name, schema] of routeParams(r)) if (schema && name in raw) raw[name] = coerce(raw[name], schema);
        const concretePath = r.segments
          .flatMap((seg) => seg.startsWith(":") ? pathValue(raw[paramName(seg)], isCatchall(seg)) : seg)
          .join("/");
        // path params go into the URL; unknown fields stay, so invoke() rejects them
        const pathNames = new Set(routeParams(r).map(([name]) => name));
        const qShape = shapeOf(r.verb.query);
        const input: Params = {}, query: Params = {};
        for (const [k, v] of Object.entries(raw)) {
          if (!pathNames.has(k)) (k in qShape || !r.verb.input ? query : input)[k] = v;
        }
        return invoke(tree, r.method, "/" + concretePath, { input, query });
      },
    });
  }
  return tools;
}

function pathValue(v: unknown, rest = false) {
  const vals = rest && Array.isArray(v) ? v : rest ? String(v ?? "").split("/") : [v];
  return vals.map((x) => encodeURIComponent(String(x ?? "")));
}
