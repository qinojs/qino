// Expose the app's api action tree to the user's AI agent as WebMCP tools.
// https://webmachinelearning.github.io/webmcp/
import { api } from "@qino/pub/api.js";

const mc = document.modelContext;
mc && register();

async function register() {
  const tools = await api["cms.webmcp"].tools.get();
  for (const tool of tools) {
    mc.registerTool({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      execute: (args = {}) => call(tool, args),
    });
  }
}

// Resolve the tool's path template against args, then RPC via the api client.
// Path params (":id", ":path*") go into the URL, everything else into body/query.
function call(tool, args) {
  const pathParams = new Set();
  let node = api;
  for (const seg of tool.path.split("/")) {
    if (seg.startsWith(":")) {
      const name = seg.slice(1).replace(/\*$/, "");
      pathParams.add(name);
      const v = args[name];
      node = Array.isArray(v) ? node(...v) : node[v];
    } else {
      node = node[seg];
    }
  }
  const rest = {};
  for (const k in args) if (!pathParams.has(k)) rest[k] = args[k];
  return node[tool.method](rest);
}
