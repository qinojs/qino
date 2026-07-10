# mcp

Generic MCP server (Model Context Protocol, Streamable HTTP, stateless). Exposes the
app's apt tree as MCP tools, so any MCP-capable client (Claude, ChatGPT-CLIs, IDEs, …)
can operate the CMS. Access filtering and per-call `access`/`guard` checks are the same
as for the REST API — the client can only do what the authenticated user may do.

Endpoint: `POST {appURL}mcp` — handled methods: `initialize`, `ping`, `tools/list`, `tools/call`.

## Einbindung in server.ts

Mit `app.importAll(…)` automatisch dabei; sonst:

```ts
await app.import(import.meta.resolve("../qino/module/api_key/plugin.ts")); // Bearer auth
await app.import(import.meta.resolve("../qino/module/mcp/plugin.ts"));
```

## Client verbinden

Auth ist stateless Bearer (siehe `api_key`) — ohne gültigen Key antwortet der Endpoint 401.

```bash
# Beispiel Claude Code:
claude mcp add --transport http qino https://example.com/mcp \
  --header "Authorization: Bearer qk_…"
```

Andere Clients analog: Transport „HTTP“ / „Streamable HTTP“, URL `{appURL}mcp`,
Header `Authorization: Bearer qk_…`. OAuth (für Clients ohne Header-Support wie
claude.ai-Web-Connectors) ist nicht implementiert.

## Verhältnis zu cms.webmcp

`cms.webmcp` exponiert dieselben apt-Tools browserseitig (WebMCP, `navigator.modelContext`)
für den eingeloggten Besucher; `mcp` exponiert sie serverseitig für externe Agents.

## TODO (Eingriffe in andere Module, bewusst noch nicht gemacht)

- [ ] `cms.webmcp`: Access-Filter (`webmcpTools`) und `mcp/listTools` duplizieren dieselbe Logik —
      gemeinsamen Helper nach `core/lib/apt/` ziehen und beide Module darauf umstellen.
- [ ] OAuth-Flow der MCP-Spec ergänzen, falls Clients ohne Header-Support (claude.ai-Connectors, ChatGPT) nötig werden:
      Resource-Metadata (`/.well-known/oauth-protected-resource`) + `WWW-Authenticate`-Hinweis,
      Authorization-Server (RFC 8414-Metadata, `authorize` mit Login+Consent, `token` mit PKCE, Refresh),
      Dynamic Client Registration (RFC 7591, eigene Tabelle), Access-Tokens analog api_key (Hash, Ablauf).
