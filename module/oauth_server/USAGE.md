# oauth_server

Andere Apps dürfen qino im Namen eines Users nutzen, wenn dieser zustimmt.

qino wird damit zum OAuth-2.1-Authorization-Server. Nach Login und Zustimmung bekommt die App ein
Bearer-Token mit den Rechten des Users. Öffentliche Clients nutzen den Code-Flow mit PKCE.

Gegenstück zu `auth.oauth`: dort meldet sich qino *bei* fremden Providern an, hier melden sich
fremde Clients *bei* qino an.

## Einbindung in server.ts

Mit `store.addAll()` automatisch dabei; sonst:

```ts
app.modules.add(import.meta.resolve("../qino/module/oauth_server/plugin.ts"));
```

## Endpoints

| Pfad                                          | Zweck                                        |
|-----------------------------------------------|----------------------------------------------|
| `GET\|POST {appUrl}authorize`                  | Login + Consent, gibt den Code aus            |
| `POST {appUrl}token`                           | Code einlösen, Refresh rotieren               |
| `POST {appUrl}register`                        | Dynamic Client Registration (RFC 7591)        |
| `GET /.well-known/oauth-authorization-server`  | AS-Metadata (RFC 8414)                        |
| `GET /.well-known/oauth-protected-resource`    | Resource-Metadata (RFC 9728)                  |

Die Metadata-Pfade liegen an der Domain-Wurzel. Läuft die App unter einem Unterpfad, muss die
Discovery-URL im Client eingetragen werden.

## Login ohne CMS

`/authorize` zeigt ein eigenes Formular mit den Core-Feldern (`core_login`, `email`, `pw`,
`csrfToken`). Das Login macht `loginFromRequest()` im Core, bevor die Route läuft — das Modul sieht
nie ein Passwort und braucht keine CMS-Loginseite.

## Client verbinden

Clients mit Dynamic Registration brauchen nur die URL der Ressource; Registrierung, Login und
Zustimmung laufen im Browser.

Clients mit fester Client-ID werden vorher angelegt — im Backend unter
`cms.backend.superuser.oauth_server` oder im Code:

```ts
import { saveClient } from "@qino/qino/oauth_server";
await saveClient(app, { id: "meine-app", name: "Meine App", redirectUris: ["https://example.com/callback"] });
```

`redirect_uris` werden exakt verglichen — kein Präfix-, kein Wildcard-Match.

Ein konkretes Beispiel (MCP-Clients ohne Header-Support) steht in `module/mcp/USAGE.md`.

## API

Basis: `{appUrl}api/oauth_server/` — nur Selbstbedienung; Clients verwaltet das Backend-Modul.

| Methode | Pfad                | Access | Beschreibung                                   |
|---------|---------------------|--------|------------------------------------------------|
| GET     | `grants`            | USER   | Clients, die aktuell Tokens des Users halten    |
| DELETE  | `grant/:clientId`   | USER   | Eigene Tokens eines Clients widerrufen          |

Programmatisch: `saveClient()` und `deleteClient()` aus `mod.ts`.

## Settings

| Key                   | Default | Bedeutung                              |
|-----------------------|---------|-----------------------------------------|
| `dynamicRegistration` | true    | Clients dürfen sich selbst registrieren  |

Token-Lebensdauern sind fest: Code 120 s, Access 1 h, Refresh 30 Tage.

## Sicherheit

- **PKCE ist Pflicht** (`S256`); ohne Challenge bricht `/authorize` ab.
- Codes gelten 120 Sekunden und genau einmal; Refresh-Tokens rotieren bei jeder Nutzung.
- Von Tokens wird nur der SHA-256 gespeichert — wie bei `auth.api_keys` sind sie nicht auslesbar, nur widerrufbar.
- Der Consent-Post ist CSRF-geprüft, sonst könnte eine fremde Seite die Zustimmung auslösen.
- Tokens eines deaktivierten Users verifizieren nicht mehr.
- **Dynamic Registration ist offen** — so will es die Spec, und es ist harmlos: eine Registrierung
  gewährt nichts, erst die Zustimmung des Users. Wer keine anonymen Clients will, setzt
  `dynamicRegistration` auf `false` und legt Clients selbst an.

## Offen

Bewusst weggelassen, bis es jemand braucht:

- **Scopes.** Weder gespeichert noch geprüft — ein Token hat immer die vollen Rechte des Users.
  Scopes müssten zuerst ins Zugriffsmodell, nicht hierher.
- **`resource` (RFC 8707).** Wird akzeptiert, aber nicht als Audience erzwungen.
- **Konfigurierbare Lebensdauern.** Als Settings aufziehen, falls jemand andere Werte braucht. (braucht doch niemand!?)
- **Consent-Gedächtnis.** Der User bestätigt bei jeder Autorisierung neu (Refreshes laufen ohne).
  Bräuchte eine Tabelle User × Client.
- **Herkunft eines Clients.** Nicht gespeichert, ob ein Client aus `/register` oder vom Superuser
  kommt — nützlich, um selbst registrierte Clients aufzuräumen.
