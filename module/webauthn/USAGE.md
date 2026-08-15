# webauthn

WebAuthn-Modul (Passkeys, Fingerabdruck, Face ID, Hardware-Key). Unabhängig vom CMS.

## Einbindung in server.ts

```ts
app.modules.add(import.meta.resolve("../qino/module/webauthn/plugin.ts"));

// Optional:
app.modules.add(import.meta.resolve("../qino/module/cms.cont.webauthn/plugin.ts"));
app.modules.add(import.meta.resolve("../qino/module/cms.backend.webauthn/plugin.ts"));
```

## Settings

| Key      | Default       | Beschreibung                                      |
|----------|---------------|---------------------------------------------------|
| `rpId`   | `"localhost"` | Domain ohne Protokoll, z.B. `example.com`         |
| `rpName` | `"Qino"`      | Anzeigename im Authenticator-Dialog               |
| `origin` | abgeleitet    | Erlaubte Origin(s), kommagetrennt, z.B. `https://example.com:8443`. Ohne Setting wird die Request-Origin akzeptiert, wenn ihr Host zur `rpId` passt |

## API

Basis: `{appUrl}api/webauthn/`

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
import { WebAuthn } from "/m/webauthn/pub/webauthn.js";

const wa = new WebAuthn({ apiBase: "/cms1/api/webauthn" });
await wa.register({ name: "Mein MacBook" });
await wa.login({ email: "user@example.com" });
await wa.loginConditional(); // Autofill-Passkey (Conditional UI), null wenn nicht verfügbar
```

Fertige Login-/Verwaltungs-UI liefert das Content-Modul `cms.cont.webauthn` (siehe unten).

## Step-up Authentication

```js
const r = await wa.confirm(); // öffnet Authenticator-Dialog
if (r.ok) { /* geschützte Aktion */ }
```

Server-seitig prüfen (z.B. max. 60 Sekunden gültig):
```ts
const confirmed = Number(await ctx.sess.data.webauthn_confirmed() ?? "0");
if (now() - confirmed > 60) return { ok: false, error: "confirmation_required" };
```

Bisher prüft das niemand. Wie daraus eine faktor-unabhängige Bestätigung am api-Endpunkt werden
könnte, steht im Workspace in `PLAN-confirm.md`.

## Hook

```ts
app.on("webauthn:login", ({ usr_id }) => { /* nach erfolgreichem WebAuthn-Login */ });
```

## CMS-Module

**`cms.cont.webauthn`** — Content-Node, Settings:

| Setting               | Beschreibung                                        |
|-----------------------|-----------------------------------------------------|
| `mode`                | `auto` / `login` / `manage`                         |
| `apiBase`             | URL der API (Standard: aus App-Pfad abgeleitet)     |
| `showPasswordFallback`| Zeigt zusätzlich Passwort-Formular                  |
| `redirectAfterLogin`  | Page-ID für Weiterleitung nach Login                |

**`cms.backend.webauthn`** — Backend-Seite, listet alle Credentials (Superuser).
