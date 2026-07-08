import { isStaticAccess, toTools, walk, type AptTree, type RequestContext } from "../core/mod.ts";

/** WebMCP tool descriptors: the MCP tool shape (from toTools) plus the method+path a client needs to call the route.
 *  Routes are filtered by their static access (PUBLIC/USER/SUPERUSER); param-dependent access stays in and is enforced on call. */
export async function webmcpTools(tree: AptTree, ctx: RequestContext) {
  const meta = new Map(toTools(tree).map((t) => [t.name, t]));
  const tools = [];
  for (const r of walk(tree)) {
    const access = r.verb.access;
    if (!access) continue; // uncallable without an access rule
    if (isStaticAccess(access) && !(await access({}, ctx))) continue;
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
