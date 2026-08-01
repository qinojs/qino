# web_auth

WebAuthn-Modul (Passkeys, Fingerabdruck, Face ID, Hardware-Key). Unabhängig vom CMS.

## Einbindung in server.ts

```ts
app.modules.add(import.meta.resolve("../qino/module/web_auth/plugin.ts"));

// Optional:
app.modules.add(import.meta.resolve("../qino/module/cms.cont.web_auth/plugin.ts"));
app.modules.add(import.meta.resolve("../qino/module/cms.backend.web_auth/plugin.ts"));
```

## Settings

| Key      | Default       | Beschreibung                                      |
|----------|---------------|---------------------------------------------------|
| `rpId`   | `"localhost"` | Domain ohne Protokoll, z.B. `example.com`         |
| `rpName` | `"Qino"`      | Anzeigename im Authenticator-Dialog               |
| `origin` | abgeleitet    | Erlaubte Origin(s), kommagetrennt, z.B. `https://example.com:8443`. Ohne Setting wird die Request-Origin akzeptiert, wenn ihr Host zur `rpId` passt |

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
import { WebAuth } from "/m/web_auth/pub/web_auth.js";

const wa = new WebAuth({ apiBase: "/cms1/api/web_auth" });
await wa.register({ name: "Mein MacBook" });
await wa.login({ email: "user@example.com" });
await wa.loginConditional(); // Autofill-Passkey (Conditional UI), null wenn nicht verfügbar
```

Fertige Login-/Verwaltungs-UI liefert das Content-Modul `cms.cont.web_auth` (siehe unten).

## Step-up Authentication

```js
const r = await wa.confirm(); // öffnet Authenticator-Dialog
if (r.ok) { /* geschützte Aktion */ }
```

Server-seitig prüfen (z.B. max. 60 Sekunden gültig):
```ts
const confirmed = Number(await ctx.sess.data.web_auth_confirmed() ?? "0");
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
