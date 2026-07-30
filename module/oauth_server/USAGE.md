# oauth_server

OAuth 2.1 Authorization Server: Autorisierungscode-Flow mit PKCE für öffentliche Clients. Ein
Client bekommt nach der Zustimmung des Users ein opakes Bearer-Token, mit dem er als dieser User
auftritt — also genau so weit reicht, wie der User selbst reicht.

Gegenstück zum Modul `oauth`, das die andere Rolle spielt: dort meldet sich qino *bei* fremden
Providern an, hier melden sich fremde Clients *bei* qino an.

Gebaut für MCP-Clients ohne Header-Support (claude.ai-Connectors, ChatGPT), aber nicht darauf
beschränkt — jeder OAuth-Client funktioniert.

## Einbindung in server.ts

Mit `app.importAll(…)` automatisch dabei; sonst:

```ts
await app.import(import.meta.resolve("../qino/module/oauth_server/plugin.ts"));
```

## Endpoints

| Pfad                                          | Zweck                                        |
|-----------------------------------------------|----------------------------------------------|
| `GET\|POST {appURL}authorize`                  | Login + Consent, gibt den Code aus            |
| `POST {appURL}token`                           | Code einlösen, Refresh rotieren               |
| `POST {appURL}register`                        | Dynamic Client Registration (RFC 7591)        |
| `GET /.well-known/oauth-authorization-server`  | AS-Metadata (RFC 8414)                        |
| `GET /.well-known/oauth-protected-resource`    | Resource-Metadata (RFC 9728)                  |

Die Metadata-Pfade liegen an der Domain-Wurzel — bei einem Mount auf einem Unterpfad findet ein
Client sie nicht von selbst, dann muss die Discovery-URL im Client konfiguriert werden.

## Login ohne CMS

`/authorize` rendert ein eigenes Formular mit den Core-Feldern (`core_login`, `email`, `pw`,
`csrfToken`). Eingeloggt wird also von `authListen()` im Core, bevor die Route überhaupt läuft —
das Modul sieht nie ein Passwort und braucht keine CMS-Loginseite.

## Client verbinden

Clients, die sich selbst registrieren können (die meisten MCP-Clients), brauchen nur die URL des
MCP-Endpoints — Registration, Login und Consent laufen dann im Browser ab.

Für Clients mit fester Client-ID legt ein Superuser sie vorher an:

```
POST {appURL}api/oauth_server/clients
{ "id": "1", "name": "Claude", "redirect_uris": ["https://claude.ai/api/mcp/auth_callback"] }
```

`redirect_uris` werden exakt verglichen — kein Präfix-, kein Wildcard-Match.

## API

Basis: `{appURL}api/oauth_server/`

| Methode | Pfad                | Access    | Beschreibung                                   |
|---------|---------------------|-----------|------------------------------------------------|
| GET     | `clients`           | SUPERUSER | Registrierte Clients auflisten                  |
| POST    | `clients`           | SUPERUSER | Client mit fester `client_id` anlegen           |
| DELETE  | `client/:id`        | SUPERUSER | Client und alle seine Tokens löschen            |
| GET     | `grants`            | USER      | Clients, die aktuell Tokens des Users halten    |
| DELETE  | `grant/:clientId`   | USER      | Eigene Tokens eines Clients widerrufen          |

## Settings

| Key                   | Default | Bedeutung                                          |
|-----------------------|---------|----------------------------------------------------|
| `accessTokenTtl`      | 3600    | Lebensdauer eines Access-Tokens in Sekunden         |
| `refreshTokenTtl`     | 2592000 | Lebensdauer eines Refresh-Tokens; jede Nutzung rotiert |
| `dynamicRegistration` | true    | Clients dürfen sich selbst registrieren             |

## Sicherheit

- **PKCE ist Pflicht** (`S256`); ohne Challenge bricht `/authorize` ab.
- Codes gelten 120 Sekunden und genau einmal; Refresh-Tokens rotieren bei jeder Nutzung.
- Von Tokens wird nur der SHA-256 gespeichert — wie bei `api_key` sind sie nicht auslesbar, nur widerrufbar.
- Der Consent-Post ist CSRF-geprüft, sonst könnte eine fremde Seite die Zustimmung auslösen.
- Tokens eines deaktivierten Users verifizieren nicht mehr.
- **Dynamic Registration ist offen** — das ist die Spec-Vorgabe und für sich harmlos: eine Registrierung
  gewährt nichts, erst die Zustimmung des Users im Browser tut das. Wer die anonymen Client-Zeilen nicht
  will, setzt `dynamicRegistration` auf `false` und legt Clients per API an.

## Offen

- Kein Consent-Gedächtnis: der User bestätigt bei jeder Autorisierung neu (Refreshes laufen ohne).
- `scope` wird durchgereicht und gespeichert, aber nicht ausgewertet — der Zugriff ist immer der volle
  des Users. Ebenso `resource` (RFC 8707): akzeptiert, nicht als Audience erzwungen.
