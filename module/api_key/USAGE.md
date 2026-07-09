# api_key

Per-user API keys. A logged-in user can mint, list and revoke keys; a key is meant to
authenticate machine calls to the apt API (`{appURL}api/…`) as that user.

Tokens are opaque (`qk_` + 256 random bits). Only their SHA-256 is stored (unique index),
so a token is shown **once** at creation and can never be read back — only revoked.

## Einbindung in server.ts

```ts
await app.import(import.meta.resolve("../qino/module/api_key/plugin.ts"));

// Optional UI:
await app.import(import.meta.resolve("../qino/module/cms.cont.my.api_keys/plugin.ts"));         // self-service
await app.import(import.meta.resolve("../qino/module/cms.backend.superuser.api_keys/plugin.ts")); // admin
```

## API (session-authenticated)

Basis: `{appURL}api/api_key/`

| Methode | Pfad        | Access | Beschreibung                                   |
|---------|-------------|--------|------------------------------------------------|
| GET     | `keys`      | USER   | Eigene Keys auflisten (id, name, prefix, …)    |
| POST    | `keys`      | USER   | Key erzeugen → `{ id, token }` (Token einmalig) |
| DELETE  | `key/:id`   | USER   | Key löschen (eigener, oder beliebiger als superuser) |

`POST keys` input: `{ name?, expires? }` — `expires` in Unix-Sekunden, weglassen = kein Ablauf.

## Client verwendet einen Key

```
curl -H "Authorization: Bearer qk_…" {appURL}api/<module>/<endpoint>
```

Der Request wird als der Key-User behandelt; jeder `Access.USER`-Endpoint funktioniert damit.

## Activating bearer auth (saubere core-Eingriffe)

Das Modul mutiert **bewusst nichts** an fremdem Request-State. Damit ein `Authorization: Bearer`
zur Request-Identität wird, fehlt im core nur **eine** Sache: ein generischer, request-scoped
Auth-Punkt (nicht api_key-spezifisch — jeder künftige Authenticator nutzt ihn). Das `action`-Event
und der CSRF-Skip (`AptFetchAuth`) existieren bereits und werden nur wiederverwendet.

**Pflicht:**

1. **`core/lib/RequestContext.ts`** — request-scoped Identität (der einzige echte Neuzugang;
   eigenes Feld, damit die anonyme Session unberührt bleibt):
   ```ts
   statelessAuth = false;              // authed by a non-cookie credential (API key, …)
   #authUserId = 0;
   authenticate(userId: number): void { this.#authUserId = userId; this.statelessAuth = true; }
   get userId(): number { return this.#authUserId || Number(this.sess.data.liveUser() || 0); }
   ```
2. **`core/lib/App.ts`** (`#route`, ~Z. 156) — bestehendes `opts.auth` übergeben, damit CSRF für
   stateless entfällt (ein Bearer-Request trägt kein ambient Cookie):
   ```ts
   return aptFetch(ctx.req, this.aptTree, "/" + uri.slice("api/".length), { auth: () => ctx.statelessAuth });
   ```
3. **`api_key/plugin.ts`** — Listener auf dem bestehenden `action`-Event (feuert vor dem Routing):
   ```ts
   export function init(app: App): void {
     app.on("action", async ({ ctx }) => {
       if (ctx.userId) return;
       const m = /^Bearer\s+(qk_[A-Za-z0-9_-]+)$/.exec(ctx.req.header("authorization")?.trim() ?? "");
       const key = m && await verifyToken(app, m[1]);
       if (key) ctx.authenticate(key.usrId);
     });
   }
   ```
   `verifyToken` (in `lib/keys.ts`) ist dafür bereits vorhanden.

**Optional (nur Aufräumen):** In `core/lib/App.ts` (`#run`, ~Z. 134) den Cookie/Session-Overhead
pro API-Call sparen: `if (!ctx.statelessAuth) this.sessions.setCookieIfNew(ctx);`. Nicht nötig für
die Korrektheit — die erzeugte Session bleibt anonym.
