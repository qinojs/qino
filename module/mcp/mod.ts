import { AptError, Output, toTools, walk, type Params, type Ctx, type Tool } from "../core/mod.ts";

/** MCP server (Streamable HTTP, stateless): exposes the app's apt tree as MCP tools.
 *  Requires stateless Bearer auth (e.g. api_key); every call re-runs access/guard via invoke. */

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

type Rpc = { jsonrpc?: string; id?: number | string | null; method?: string; params?: unknown };

class RpcErr extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

/** Handle one MCP request; always signals the response via thrown `Output`. */
export async function mcpFetch(ctx: Ctx): Promise<never> {
  if (ctx.req.method !== "POST") throw new Output({ error: "Method Not Allowed" }, { status: 405, headers: { Allow: "POST" } });
  if (!ctx.statelessAuth) throw new Output(rpcError(null, -32001, "Unauthorized: send an api key as Bearer token"), { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  const msg = ctx.req.body as Rpc; // parsed in Req.create; null = no/invalid JSON body
  if (msg === null) throw new Output(rpcError(null, -32700, "Parse error"), { status: 400 });
  if (!msg || typeof msg !== "object" || Array.isArray(msg) || typeof msg.method !== "string")
    throw new Output(rpcError(null, -32600, "Invalid Request"), { status: 400 });
  if (msg.id == null) throw new Output(undefined, { status: 202 }); // notification, e.g. notifications/initialized
  throw new Output(await respond(msg, ctx));
}

async function respond(msg: Rpc, ctx: Ctx): Promise<unknown> {
  try {
    return { jsonrpc: "2.0", id: msg.id, result: await result(msg, ctx) };
  } catch (e) {
    if (e instanceof RpcErr) return rpcError(msg.id, e.code, e.message);
    console.error("[mcp]", e);
    const detail = ctx.app.dev && e instanceof Error ? e.message : "";
    return rpcError(msg.id, -32603, detail || "Internal error");
  }
}

async function result(msg: Rpc, ctx: Ctx): Promise<unknown> {
  const params = (msg.params ?? {}) as Params;
  switch (msg.method) {
    case "initialize": {
      const requested = String(params.protocolVersion ?? "");
      return {
        protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: "qino", version: "1" },
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return { tools: await listTools(ctx) };
    case "tools/call":
      return await callTool(params, ctx);
  }
  throw new RpcErr(-32601, `Method not found: ${msg.method}`);
}

/** Same access filter as cms.webmcp: static `access` gates the list, per-call `guard` runs on invoke. */
async function listTools(ctx: Ctx) {
  const meta = new Map(toTools(ctx.app.aptTree).map((t) => [t.name, t]));
  const tools = [];
  for (const r of walk(ctx.app.aptTree)) {
    const access = r.verb.access;
    if (!access || !(await access(ctx))) continue;
    const t = meta.get(r.name);
    if (!t) continue;
    tools.push({ name: t.name, description: t.description, inputSchema: inputSchema(t) });
  }
  return tools;
}

const inputSchema = (t: Tool) => Object.keys(t.parameters).length ? t.parameters : { type: "object", properties: {} };

async function callTool(params: Params, ctx: Ctx) {
  const name = String(params.name ?? "");
  const tool = toTools(ctx.app.aptTree).find((t) => t.name === name);
  if (!tool) throw new RpcErr(-32602, `Unknown tool: ${name}`);
  try {
    const result = await tool.execute(params.arguments ?? {}, ctx);
    return {
      content: [{ type: "text", text: result === undefined ? "ok" : JSON.stringify(result) }],
      ...(result !== null && typeof result === "object" && !Array.isArray(result) && { structuredContent: result }),
    };
  } catch (e) {
    if (e instanceof Output) return outputContent(e); // endpoints that answer with a raw response signal
    const detail = e instanceof AptError ? e.message + (e.issues ? " " + JSON.stringify(e.issues) : "")
      : ctx.app.dev && e instanceof Error ? e.message : "";
    if (!(e instanceof AptError)) console.error("[mcp]", e);
    return { content: [{ type: "text", text: detail || "Internal error" }], isError: true };
  }
}

function outputContent(o: Output) {
  const text = typeof o.body === "string" ? o.body : "(non-text response)";
  return { content: [{ type: "text", text }], ...(o.status >= 400 && { isError: true }) };
}

const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
