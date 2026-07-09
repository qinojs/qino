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

## Activating bearer auth (nötige, saubere core-Eingriffe)

Das Modul mutiert **bewusst nichts** an fremdem Request-State. Damit ein `Authorization: Bearer`
zur Request-Identität wird, braucht der core einen generischen, request-scoped Auth-Punkt
(nicht api_key-spezifisch — jeder künftige Authenticator nutzt ihn). Vier kleine Eingriffe:

1. **`core/lib/RequestContext.ts`** — request-scoped Identität (kein Cookie, keine Session-Mutation):
   ```ts
   statelessAuth = false;              // authed by a non-cookie credential (API key, …)
   #authUserId = 0;
   authenticate(userId: number): void { this.#authUserId = userId; this.statelessAuth = true; }
   get userId(): number { return this.#authUserId || Number(this.sess.data.liveUser() || 0); }
   ```
2. **`core/lib/App.ts`** — `"auth"` zu `AppEvents` hinzufügen (`{ ctx: RequestContext }`).
3. **`core/lib/init.ts`** — in `initRequest`, nach `authListen(ctx)`:
   ```ts
   if (!ctx.userId) await ctx.app.fire("auth", { ctx });
   ```
4. **`core/lib/App.ts`** — stateless-Requests bekommen kein Cookie und keine CSRF-Pflicht
   (ein Bearer-Request trägt kein ambient Cookie, CSRF ist damit gegenstandslos):
   ```ts
   if (!ctx.statelessAuth) this.sessions.setCookieIfNew(ctx);          // #run
   return aptFetch(ctx.req, this.aptTree, "/" + uri.slice("api/".length), { auth: () => ctx.statelessAuth }); // #route
   ```

Dann in **`api_key/plugin.ts`** den Listener registrieren:
```ts
export function init(app: App): void {
  app.on("auth", async ({ ctx }) => {
    const m = /^Bearer\s+(qk_[A-Za-z0-9_-]+)$/.exec(ctx.req.header("authorization")?.trim() ?? "");
    const key = m && await verifyToken(app, m[1]);
    if (key) ctx.authenticate(key.usrId);
  });
}
```
`verifyToken` (in `lib/keys.ts`) ist dafür bereits vorhanden.
