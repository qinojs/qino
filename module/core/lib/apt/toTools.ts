import type { Ctx } from "../ctx/Ctx.ts";
import { toJsonSchema } from "../StandardSchema.ts";
import { asParams, invoke } from "./invoke.ts";
import { checkCollisions, isCatchall, paramName, routeParams, shapeOf, walk } from "./route.ts";
import type { AptTree, Method } from "./types.ts";

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: unknown, ctx: Ctx): Promise<unknown>;
}

export function toTools(tree: AptTree, opts: { apis?: Record<string, Method[]> } = {}): Tool[] {
  const tools: Tool[] = [];
  for (const r of walk(tree)) {
    checkCollisions(r);
    const pathStr = "/" + r.segments.join("/");
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
      parameters: Object.keys(properties).length ? { type: "object", properties, required } : {},
      execute: (args) => {
        const raw = { ...asParams(args) };
        // zzz needed? for (const [name, schema] of routeParams(r)) if (schema && name in raw) raw[name] = coerce(raw[name], schema);
        const concretePath = r.segments
          .flatMap((seg) => seg.startsWith(":") ? pathValue(raw[paramName(seg)], isCatchall(seg)) : seg)
          .join("/");
        const body = { ...raw }; // path params travel in the URL, not the field bag (strict rejects unknowns)
        for (const [name] of routeParams(r)) delete body[name];
        return invoke(tree, r.method, "/" + concretePath, { input: body, query: body });
      },
    });
  }
  return tools;
}

function pathValue(v: unknown, rest = false): string[] {
  const vals = rest && Array.isArray(v) ? v : rest ? String(v ?? "").split("/") : [v];
  return vals.map((x) => encodeURIComponent(String(x ?? "")));
}
