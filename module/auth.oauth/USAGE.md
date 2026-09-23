# auth.oauth — Login via external providers (OIDC & plain OAuth2)

Sign in through an external provider; opens a normal Qino session via `login()`. Two kinds:

- **OIDC** (Google, Microsoft, GitLab, Auth0, Slack, Keycloak, …) — endpoints via
  discovery, identity from the `id_token`, Authorization Code + PKCE.
- **plain OAuth2** (GitHub, Discord, …) — explicit endpoints, identity from a
  `userinfo` call with the access token (no `id_token`).

Per provider: `authorize_url` set → OAuth2; empty and `issuer` set → OIDC discovery.

## Konfigurieren

Im Backend-Modul **`cms.backend.superuser.auth.oauth`** (Superuser → Login providers). Gängige
Provider sind als Vorlagen angelegt — meist nur `client_id`/`client_secret` eintragen. Die
Redirect-URI für den Provider zeigt das Formular an: **`{appUrl}oauth/callback/<name>`**.

Tabelle `oauth_provider`:

| Feld | Zweck |
|---|---|
| `name` | Slug in der URL (url-safe/lowercase) |
| `issuer` | OIDC: Basis-URL für Discovery, z.B. `https://accounts.google.com` |
| `authorize_url` / `token_url` / `userinfo_url` | OAuth2: explizite Endpunkte (kein Discovery) |
| `email_url` | OAuth2 optional: separater E-Mail-Endpoint (z.B. GitHub `/user/emails`) |
| `client_id` / `client_secret` | vom Provider |
| `scopes` | leer = `openid email profile` |
| `auto_create` | `1` = unbekannte, verifizierte User anlegen, `0` = nur bestehende |
| `allowed_domains` | optional, kommagetrennt (z.B. `example.com`) — begrenzt öffentliche Provider |

## Wer mit wem verknüpft ist

Tabelle `oauth_provider_usr` (`provider`, `sub`) → `usr_id` speichert beim ersten Login die
stabile Id des Providers (OIDC `sub`, sonst `id`). Danach zählt diese Verknüpfung, nicht mehr die
E-Mail — ändert sich die E-Mail auf einer Seite, bleibt das Konto dasselbe. Ohne Verknüpfung wird
per verifizierter E-Mail zugeordnet (oder angelegt) und die Verknüpfung gespeichert.

`allowed_domains` gilt, wo eine E-Mail mitkommt; eine bestehende Verknüpfung bleibt aber, auch
wenn der Provider später keine E-Mail mehr schickt (Apple). Die Backend-Seite listet alle
Verknüpfungen und kann sie einzeln lösen; danach gilt wieder die E-Mail. Wird ein Provider
gelöscht, verschwinden seine Verknüpfungen.

### Mitgelieferte Presets

- **OIDC:** `google`, `microsoft`, `apple`, `auth0`, `gitlab`, `linkedin`, `slack`
  (`<tenant>` bei `microsoft`/`auth0` durch deine Domain/Tenant ersetzen).
- **OAuth2:** `github`, `discord`.
- **`apple`** braucht als `client_secret` ein kurzlebiges ES256-JWT statt eines festen
  Secrets — das Modul erzeugt es nicht.

Weitere OAuth2-Provider: neue Zeile mit `authorize_url`, `token_url`, `userinfo_url`
(+ ggf. `email_url`).

## Login starten

**`cms.cont.oauth`** zeigt einen „Log in with …"-Link pro Provider, **`cms.cont.my.oauth`**
zeigt dem Benutzer seine Verknüpfungen und verbindet weitere. Oder direkt verlinken:

```html
<a href="{appUrl}oauth/start/github">Login mit GitHub</a>
```

Optional `?return_to=/pfad` (nur lokale Pfade werden akzeptiert).

## Sicherheit (was durchgesetzt wird)

- **OIDC:** Authorization Code + **PKCE** (`S256`); `state`, `nonce`, `code_verifier` liegen in
  der Session und werden im Callback einmal geprüft und verbraucht.
- **id_token:** `iss`, `aud`, `nonce`, `exp` werden geprüft. Die **Signatur** bewusst nicht
  (`jwks_uri`) — im Code-Flow kommt das Token per TLS direkt vom `token_endpoint` (OIDC erlaubt das).
- **OAuth2:** kein `id_token`/`nonce`; `state` schützt vor CSRF, die Identität kommt vom
  `userinfo`-Call.
- **`email_verified`:** ein explizit unverifiziertes E-Mail-Claim wird abgelehnt.
- **Open-Redirect:** `return_to` nur lokale Pfade (kein `//`, kein Schema).
- **Backend:** `client_secret` wird nie zurückgerendert.
- **Achtung Account-Linking:** beim *ersten* Login landet eine verifizierte E-Mail im
  bestehenden Qino-User mit derselben E-Mail (auch einem Superuser); danach zählt die
  Verknüpfung. Mit `auto_create` bei einem öffentlichen Provider kommt jeder mit Konto dort
  rein (ohne Rechte) — dann `allowed_domains` setzen.

## Offen / verbesserungswürdig

Kern:
- **JWKS-Signaturprüfung** als Defense-in-Depth; **`azp`** prüfen bei mehreren `aud`.
- **Refresh-Tokens / RP-Logout** (`end_session_endpoint`): nicht implementiert.
- **Apple client_secret-JWT** (ES256) generieren; **Microsoft Multi-Tenant** (`iss` mit
  Tenant-ID) unterstützen.
- **Zwei Logins parallel** (zwei Tabs) überschreiben sich in der Session → Fix: per `state`
  speichern.

Backend (bewusst schlank):
- Keine `name`-Validierung; doppelter Name → DB-Fehler (500).
- Kein Speichern/Löschen-Feedback, kein „Vorlage vs. konfiguriert"-Badge.

Sonstiges:
- Automatisch getestet sind `resolveUser()`/`identity()`; der Callback (Token-Tausch,
  id_token-Prüfung) nur manuell.
