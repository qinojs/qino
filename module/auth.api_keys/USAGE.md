# auth.api_keys

Per-user API keys. A logged-in user can mint, list and revoke keys; a key is meant to
authenticate machine calls to the api API (`{appUrl}api/…`) as that user.

Tokens are opaque (`qk_` + 256 random bits). Only their SHA-256 is stored (unique index),
so a token is shown **once** at creation and can never be read back — only revoked.

## Einbindung in server.ts

```ts
app.modules.add(import.meta.resolve("../qino/module/auth.api_keys/plugin.ts"));

// Optional UI:
app.modules.add(import.meta.resolve("../qino/module/cms.cont.my.api_keys/plugin.ts"));         // self-service
app.modules.add(import.meta.resolve("../qino/module/cms.backend.superuser.auth.api_keys/plugin.ts")); // admin
```

## API (session-authenticated)

Der Modulname benennt schon die Ressource, also hängen die Verben an der Wurzel
`{appUrl}api/auth.api_keys` — wie bei [auth.totp](../auth.totp/) oder [auth.oauth](../auth.oauth/).

| Methode | Pfad   | Access | Beschreibung                                         |
|---------|--------|--------|------------------------------------------------------|
| GET     | –      | USER   | Eigene Keys auflisten (id, name, prefix, …)          |
| POST    | –      | USER   | Key erzeugen → `{ id, token }` (Token einmalig)      |
| DELETE  | `:id`  | USER   | Key löschen (eigener, oder beliebiger als superuser) |

`POST` input: `{ name?, expires? }` — `expires` in Unix-Sekunden, weglassen = kein Ablauf.

## Client verwendet einen Key

```
curl -H "Authorization: Bearer qk_…" {appUrl}api/<module>/<endpoint>
```

Der Request wird als der Key-User behandelt; jeder `Access.USER`-Endpoint funktioniert damit.

## Bearer auth

Funktioniert out of the box: das Modul hängt sich in `init` an das core-Event `authenticate`
(request-scoped Identität via `ctx.authenticate(usrId)`, gefeuert am Anfang von `initRequest`).

- **Stateless:** kein Session-/`cid`-Cookie, keine client-Zeile; CSRF entfällt (kein ambient Cookie).
- **Präzedenz:** ein mitgesendeter Bearer schlägt eine allfällige Cookie-Session.
- **Laut bei Fehlern:** ein `qk_`-Bearer, der ungültig/abgelaufen ist oder zu einem inaktiven
  User gehört → **401**, kein stiller Anonym-Fallback. Fremde Bearer-Formate fallen durch.
