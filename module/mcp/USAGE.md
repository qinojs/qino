# mcp

Generic MCP server (Model Context Protocol, Streamable HTTP, stateless). Exposes the
app's api tree as MCP tools, so any MCP-capable client (Claude, ChatGPT-CLIs, IDEs, …)
can operate the CMS. Access filtering and per-call `access`/`guard` checks are the same
as for the REST API — the client can only do what the authenticated user may do.

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

**OAuth** (`oauth_server`) — für Clients ohne Header-Support (claude.ai-Connectors, ChatGPT):
Modul einbinden, im Client nur die URL `{appUrl}mcp` eintragen. Der 401 verweist dann auf
`/.well-known/oauth-protected-resource`, der Client registriert sich selbst und schickt den
User zu Login und Consent.

## Verhältnis zu cms.webmcp

`cms.webmcp` exponiert dieselben api-Tools browserseitig (WebMCP, `navigator.modelContext`)
für den eingeloggten Besucher; `mcp` exponiert sie serverseitig für externe Agents.

## TODO (Eingriffe in andere Module, bewusst noch nicht gemacht)

- [ ] `cms.webmcp`: Access-Filter (`webmcpTools`) und `mcp/listTools` duplizieren dieselbe Logik —
      gemeinsamen Helper nach `core/lib/api/` ziehen und beide Module darauf umstellen.
