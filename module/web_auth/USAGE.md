# web_auth

WebAuthn-Modul (Passkeys, Fingerabdruck, Face ID, Hardware-Key). Unabhängig vom CMS.

## Einbindung in server.ts

```ts
await app.import(import.meta.resolve("../qino/module/web_auth/mod.ts"));

// Optional:
await app.import(import.meta.resolve("../qino/module/cms.cont.web_auth/mod.ts"));
await app.import(import.meta.resolve("../qino/module/cms.backend.web_auth/mod.ts"));
```

## Settings

| Key      | Default       | Beschreibung                                      |
|----------|---------------|---------------------------------------------------|
| `rpId`   | `"localhost"` | Domain ohne Protokoll, z.B. `example.com`         |
| `rpName` | `"Qino"`      | Anzeigename im Authenticator-Dialog               |

## API

Basis: `{appURL}api/web_auth/`

| Methode | Pfad                    | Auth    | Beschreibung                          |
|---------|-------------------------|---------|---------------------------------------|
| POST    | `register/challenge`    | USER    | Challenge für Registrierung           |
| POST    | `register/verify`       | USER    | Credential speichern                  |
| POST    | `login/challenge`       | PUBLIC  | Challenge für Login                   |
| POST    | `login/verify`          | PUBLIC  | Login verifizieren → Session          |
| GET     | `credentials`           | USER    | Eigene Credentials auflisten          |
| DELETE  | `credential/:id`        | USER    | Credential löschen                    |
| POST    | `confirm/challenge`     | USER    | Step-up Challenge anfordern           |
| POST    | `confirm/verify`        | USER    | Step-up bestätigen → Session-Flag     |

## Client

```js
import { WebAuth, initWebAuth } from "/m/web_auth/pub/web_auth.js";

// Manuell:
const wa = new WebAuth({ apiBase: "/cms1/api/web_auth" });
await wa.register({ name: "Mein MacBook" });
await wa.login({ email: "user@example.com" });

// Oder per data-Attribut:
initWebAuth({ apiBase: "/cms1/api/web_auth", onSuccess: () => location.reload() });
```

```html
<input type="email" autocomplete="username webauthn" data-web-auth-email>
<button data-web-auth-action="login">Mit Passkey anmelden</button>
<button data-web-auth-action="register">Passkey hinzufügen</button>
<input data-web-auth-name placeholder="Name">
```

## Step-up Authentication

```js
const r = await wa.confirm(); // öffnet Authenticator-Dialog
if (r.ok) { /* geschützte Aktion */ }
```

Server-seitig prüfen (z.B. max. 60 Sekunden gültig):
```ts
const confirmed = parseInt(String(await ctx.session.web_auth_confirmed() ?? "0"));
if (now() - confirmed > 60) return { ok: false, error: "confirmation_required" };
```

## Hook

```ts
app.on("web_auth:login", ({ usr_id }) => { /* nach erfolgreichem WebAuthn-Login */ });
```

## CMS-Module

**`cms.cont.web_auth`** — Content-Node, Settings:

| Setting               | Beschreibung                                        |
|-----------------------|-----------------------------------------------------|
| `mode`                | `auto` / `login` / `manage`                         |
| `apiBase`             | URL der API (Standard: aus App-Pfad abgeleitet)     |
| `showPasswordFallback`| Zeigt zusätzlich Passwort-Formular                  |
| `redirectAfterLogin`  | Page-ID für Weiterleitung nach Login                |

**`cms.backend.web_auth`** — Backend-Seite, listet alle Credentials (Superuser).
