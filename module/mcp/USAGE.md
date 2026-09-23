# mcp

MCP server (Model Context Protocol, Streamable HTTP, stateless). Offers the app's api tree
as MCP tools to any MCP client (Claude, ChatGPT, IDEs, …). `access` and `guard` apply as in the
REST API — the client can only do what its user may do.

Endpoint: `POST {appUrl}mcp` — handled methods: `initialize`, `ping`, `tools/list`, `tools/call`.

## Einbindung in server.ts

Mit `store.addAll()` automatisch dabei; sonst:

```ts
app.modules.add(import.meta.resolve("../qino/module/auth.api_keys/plugin.ts")); // Bearer auth
app.modules.add(import.meta.resolve("../qino/module/mcp/plugin.ts"));
```

## Client verbinden

Auth ist stateless Bearer — ohne gültiges Token antwortet der Endpoint 401. Zwei Quellen:

**Eigener Header** (`auth.api_keys`) — für Clients, die einen Header setzen können:

```bash
# Beispiel Claude Code:
claude mcp add --transport http qino https://example.com/mcp \
  --header "Authorization: Bearer qk_…"
```

Andere Clients analog: Transport „HTTP“ / „Streamable HTTP“, URL `{appUrl}mcp`,
Header `Authorization: Bearer qk_…`.

**OAuth** (`oauth_server`) — für Clients ohne eigene Header (claude.ai-Connectors, ChatGPT):
im Client nur `{appUrl}mcp` eintragen. Die 401-Antwort verweist auf
`/.well-known/oauth-protected-resource`, der Client registriert sich selbst und schickt den User
zu Login und Zustimmung.

## Verhältnis zu cms.webmcp

`cms.webmcp` bietet dieselben Tools im Browser an (WebMCP, `navigator.modelContext`), für den
eingeloggten Besucher; `mcp` auf dem Server für externe Agents.

## TODO (Eingriffe in andere Module, bewusst noch nicht gemacht)

- [ ] `cms.webmcp`: Access-Filter (`webmcpTools`) und `mcp/listTools` duplizieren dieselbe Logik —
      gemeinsamen Helper nach `core/lib/api/` ziehen und beide Module darauf umstellen.
