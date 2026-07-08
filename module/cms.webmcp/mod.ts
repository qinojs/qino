import { toTools, walk, type AptTree, type RequestContext } from "../core/mod.ts";

/** WebMCP tool descriptors: the MCP tool shape (from toTools) plus the method+path a client needs to call the route.
 *  Filtered by the static `access` gate; a per-call `guard` stays in and is enforced when the tool is called. */
export async function webmcpTools(tree: AptTree, ctx: RequestContext) {
  const meta = new Map(toTools(tree).map((t) => [t.name, t]));
  const tools = [];
  for (const r of walk(tree)) {
    const access = r.verb.access;
    if (!access || !(await access(ctx))) continue;
    const t = meta.get(r.name);
    if (!t) continue;
    tools.push({
      name: t.name,
      description: t.description,
      inputSchema: t.parameters,
      method: r.method,
      path: r.segments.join("/"),
    });
  }
  return tools;
}
