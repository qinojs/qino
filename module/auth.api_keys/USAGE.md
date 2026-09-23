# auth.api_keys

API keys per user. A signed-in user can create, list and revoke keys; a key authenticates
machine calls to the API (`{appUrl}api/…`) as that user.

Tokens are `qk_` + 256 random bits. Only their SHA-256 is stored, so a token is shown **once**
and can only be revoked, never read again.

## Einbindung in server.ts

```ts
app.modules.add(import.meta.resolve("../qino/module/auth.api_keys/plugin.ts"));

// Optional UI:
app.modules.add(import.meta.resolve("../qino/module/cms.cont.my.api_keys/plugin.ts"));         // self-service
app.modules.add(import.meta.resolve("../qino/module/cms.backend.superuser.auth.api_keys/plugin.ts")); // admin
```

## API (session-authenticated)

Die Verben hängen direkt an `{appUrl}api/auth.api_keys` — der Modulname ist schon die Ressource.

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

Das Modul hört auf das core-Event `authenticate` (`ctx.authenticate(usrId, "api_key:<id>")`,
am Anfang von `initRequest`).

- **Ein Key = ein Gerät:** jeder Key hat eigenen Client und eigene Session, im Request-Log als
  Gerät sichtbar. Keine Cookies, daher kein CSRF.
- **Vorrang:** ein Bearer schlägt eine Cookie-Session.
- **Fehler sind laut:** ungültiger, abgelaufener oder inaktiver `qk_`-Key → **401**, kein
  Anonym-Fallback. Andere Bearer-Formate werden ignoriert.
