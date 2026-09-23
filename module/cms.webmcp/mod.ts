import { toTools, walk } from "@qino/qino";

import type { ApiTree, Ctx, Method } from "@qino/qino";

/** WebMCP tools: the MCP tool shape (from toTools) plus method and path. Filtered by `access`;
 *  `guard` is checked when called. */
export async function webmcpTools(tree: ApiTree, ctx: Ctx): Promise<{ name: string; description: string; inputSchema: Record<string, unknown>; method: Method; path: string }[]> {
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
