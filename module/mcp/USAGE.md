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

Auth ist stateless Bearer — ohne gültiges Token antwortet der Endpoint 401. Zwei Quellen:

**Eigener Header** (`api_key`) — für Clients, die einen Header setzen können:

```bash
# Beispiel Claude Code:
claude mcp add --transport http qino https://example.com/mcp \
  --header "Authorization: Bearer qk_…"
```

Andere Clients analog: Transport „HTTP“ / „Streamable HTTP“, URL `{appURL}mcp`,
Header `Authorization: Bearer qk_…`.

**OAuth** (`oauth_server`) — für Clients ohne Header-Support (claude.ai-Connectors, ChatGPT):
Modul einbinden, im Client nur die URL `{appURL}mcp` eintragen. Der 401 verweist dann auf
`/.well-known/oauth-protected-resource`, der Client registriert sich selbst und schickt den
User zu Login und Consent.

## Verhältnis zu cms.webmcp

`cms.webmcp` exponiert dieselben apt-Tools browserseitig (WebMCP, `navigator.modelContext`)
für den eingeloggten Besucher; `mcp` exponiert sie serverseitig für externe Agents.

## TODO (Eingriffe in andere Module, bewusst noch nicht gemacht)

- [ ] `cms.webmcp`: Access-Filter (`webmcpTools`) und `mcp/listTools` duplizieren dieselbe Logik —
      gemeinsamen Helper nach `core/lib/apt/` ziehen und beide Module darauf umstellen.
