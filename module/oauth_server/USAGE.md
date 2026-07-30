# oauth_server

OAuth 2.1 Authorization Server: Autorisierungscode-Flow mit PKCE für öffentliche Clients. Ein
Client bekommt nach der Zustimmung des Users ein opakes Bearer-Token, mit dem er als dieser User
auftritt — also genau so weit reicht, wie der User selbst reicht.

Gegenstück zum Modul `oauth`, das die andere Rolle spielt: dort meldet sich qino *bei* fremden
Providern an, hier melden sich fremde Clients *bei* qino an.

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

Clients, die Dynamic Registration beherrschen, brauchen nur die URL der geschützten Ressource;
Registrierung, Login und Consent laufen dann im Browser ab.

Für Clients mit fester Client-ID legt ein Superuser sie vorher an:

```
POST {appURL}api/oauth_server/clients
{ "id": "meine-app", "name": "Meine App", "redirect_uris": ["https://example.com/callback"] }
```

`redirect_uris` werden exakt verglichen — kein Präfix-, kein Wildcard-Match.

Ein konkretes Beispiel (MCP-Clients ohne Header-Support) steht in `module/mcp/USAGE.md`.

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

| Key                   | Default | Bedeutung                              |
|-----------------------|---------|-----------------------------------------|
| `dynamicRegistration` | true    | Clients dürfen sich selbst registrieren  |

Token-Lebensdauern sind fest: Code 120 s, Access 1 h, Refresh 30 Tage.

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

Bewusst weggelassen, bis es jemand braucht:

- **Scopes.** Werden weder gespeichert noch ausgewertet — ein Token trägt immer die vollen Rechte
  seines Users. Ein echtes Scope-Konzept müsste zuerst im Zugriffsmodell existieren, nicht hier.
- **`resource` (RFC 8707).** Wird akzeptiert, aber nicht als Audience erzwungen.
- **Konfigurierbare Lebensdauern.** Als Settings aufziehen, falls jemand andere Werte braucht. (braucht doch niemand!?)
- **Consent-Gedächtnis.** Der User bestätigt bei jeder Autorisierung neu (Refreshes laufen ohne).
  Bräuchte eine Tabelle User × Client.
- **Herkunft eines Clients.** Nicht festgehalten, ob eine Zeile aus `/register` oder von einem
  Superuser stammt — nützlich, sobald man DCR-Zeilen gezielt aufräumen will.
