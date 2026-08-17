# auth.webauthn

WebAuthn-Modul (Passkeys, Fingerabdruck, Face ID, Hardware-Key). Unabhängig vom CMS.

## Einbindung in server.ts

```ts
app.modules.add(import.meta.resolve("../qino/module/auth.webauthn/plugin.ts"));

// Optional:
app.modules.add(import.meta.resolve("../qino/module/cms.cont.webauthn/plugin.ts"));
app.modules.add(import.meta.resolve("../qino/module/cms.backend.superuser.auth.webauthn/plugin.ts"));
```

## Settings

| Key      | Default       | Beschreibung                                      |
|----------|---------------|---------------------------------------------------|
| `rpId`   | `"localhost"` | Domain ohne Protokoll, z.B. `example.com`         |
| `rpName` | `"Qino"`      | Anzeigename im Authenticator-Dialog               |
| `origin` | abgeleitet    | Erlaubte Origin(s), kommagetrennt, z.B. `https://example.com:8443`. Ohne Setting wird die Request-Origin akzeptiert, wenn ihr Host zur `rpId` passt |

## API

Basis: `{appUrl}api/auth.webauthn/`

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
import { WebAuthn } from "/m/auth.webauthn/pub/webauthn.js";

const wa = new WebAuthn({ apiBase: "/cms1/api/auth.webauthn" });
await wa.register({ name: "Mein MacBook" });
await wa.login({ email: "user@example.com" });
await wa.loginConditional(); // Autofill-Passkey (Conditional UI), null wenn nicht verfügbar
```

Fertige UI liefern die Content-Module `cms.cont.webauthn` (anmelden) und `cms.cont.my.webauthn`
(eigene Passkeys verwalten) — siehe unten.

## Step-up Authentication

```js
const r = await wa.confirm(); // öffnet Authenticator-Dialog
if (r.ok) { /* geschützte Aktion */ }
```

Der Nachweis landet über [auth](../auth/) in der Session, nicht in einem eigenen Flag — server-seitig
prüfen heisst also, wie frisch er ist:

```ts
const at = Number(ctx.sess.data.core.via.webauthn() ?? 0);
if (unixTime() - at > 60) return { ok: false, error: "confirmation_required" };
```

Das tut bisher niemand von Hand: der Guard, der das für beliebige Faktoren am api-Verb erledigt,
fehlt noch (siehe [auth](../auth/#possible-extensions)).

## CMS-Module

**`cms.cont.webauthn`** — Content-Node zum Anmelden, Settings:

| Setting               | Beschreibung                                        |
|-----------------------|-----------------------------------------------------|
| `apiBase`             | URL der API (Standard: aus App-Pfad abgeleitet)     |
| `showPasswordFallback`| Zeigt zusätzlich Passwort-Formular                  |
| `redirectAfterLogin`  | Page-ID für Weiterleitung nach Login                |

**`cms.cont.my.webauthn`** — Content-Node, auf dem der angemeldete Benutzer seine eigenen Passkeys
verwaltet. Ohne Settings.

**`cms.backend.superuser.auth.webauthn`** — Backend-Seite, listet alle Credentials (Superuser).
