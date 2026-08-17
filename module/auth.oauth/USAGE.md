# auth.oauth — Login via external providers (OIDC & plain OAuth2)

Lets Qino users sign in through an external provider and opens a normal Qino session
via `login()`. Handles both:

- **OIDC** (Google, Microsoft, GitLab, Auth0, Slack, Keycloak, …) — endpoints via
  discovery, identity from the `id_token`, Authorization Code + PKCE.
- **plain OAuth2** (GitHub, Discord, …) — explicit endpoints, identity from a
  `userinfo` call with the access token (no `id_token`).

The mode is chosen per provider: set `authorize_url` → OAuth2; leave it empty and set
`issuer` → OIDC discovery.

## Konfigurieren

Am einfachsten über das Backend-Modul **`cms.backend.superuser.auth.oauth`** (Superuser →
Social login). Gängige Provider sind bei Installation als Vorlagen angelegt — meist nur
noch `client_id`/`client_secret` eintragen. Die Redirect-URI zum Eintragen beim Provider
zeigt das Formular pro Provider an: **`{appUrl}oauth/callback/<name>`**.

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

Tabelle `oauth_provider_usr` (`provider`, `sub`) → `usr_id`: was der Provider als stabile Id
seines Benutzers liefert (OIDC `sub`, sonst `id`), gemerkt beim ersten Login. Danach folgt
jeder Login dieser Verknüpfung, nicht mehr der E-Mail — ein E-Mail-Wechsel auf einer der
beiden Seiten verschiebt das Konto also nicht mehr. Wer noch keine Verknüpfung hat, wird wie
bisher per verifizierter E-Mail zugeordnet (oder angelegt) und dabei gemerkt.

`allowed_domains` greift überall dort, wo eine E-Mail mitkommt — eine bestehende Verknüpfung
verfällt aber nicht, wenn der Provider später keine mehr schickt (Apple). Die Backend-Seite listet alle Verknüpfungen
unter der Konfiguration und kann sie einzeln lösen; danach greift für diesen Benutzer wieder
die E-Mail-Zuordnung. Wird ein Provider gelöscht, verschwinden seine Verknüpfungen mit.

### Mitgelieferte Presets

- **OIDC:** `google`, `microsoft`, `apple`, `auth0`, `gitlab`, `linkedin`, `slack`
  (`<tenant>` bei `microsoft`/`auth0` durch deine Domain/Tenant ersetzen).
- **OAuth2:** `github`, `discord`.
- **`apple`** braucht als `client_secret` ein kurzlebiges, ES256-signiertes JWT (kein
  statisches Secret) — dieses Modul generiert es nicht, also Extra-Setup nötig.

Weitere OAuth2-Provider lassen sich als Zeile anlegen: `authorize_url`, `token_url`,
`userinfo_url` (+ ggf. `email_url`) setzen.

## Login starten

Frontend-Modul **`cms.cont.oauth`** rendert einen „Log in with …"-Link pro
konfiguriertem Provider, **`cms.cont.my.oauth`** zeigt dem angemeldeten Benutzer seine
Verknüpfungen und verbindet weitere. Oder direkt verlinken:

```html
<a href="{appUrl}oauth/start/github">Login mit GitHub</a>
```

Optional `?return_to=/pfad` (nur lokale Pfade werden akzeptiert).

## Sicherheit (was durchgesetzt wird)

- **OIDC:** Authorization Code + **PKCE** (`S256`); `state`, `nonce`, `code_verifier`
  liegen server-seitig in der Session und werden im Callback einmalig geprüft/verbraucht.
- **id_token:** `iss`, `aud`, `nonce`, `exp` geprüft (Trailing-Slash-tolerant). Die
  **Signatur** wird bewusst nicht via `jwks_uri` geprüft — im Code-Flow kommt das Token
  direkt vom `token_endpoint` über TLS (OIDC erlaubt das).
- **OAuth2:** kein `id_token`/`nonce`; `state` schützt gegen CSRF, Identität kommt über
  den `userinfo`-Call (access_token direkt vom Token-Endpoint über TLS).
- **`email_verified`:** ein explizit unverifiziertes E-Mail-Claim wird abgelehnt.
- **Open-Redirect:** `return_to` nur lokale Pfade (kein `//`, kein Schema).
- **Backend:** `client_secret` wird nie zurückgerendert.
- **Achtung Account-Linking:** beim *ersten* Mal loggt eine verifizierte E-Mail in den
  bestehenden Qino-User mit derselben E-Mail ein (inkl. evtl. Superuser); danach zählt die
  gemerkte Verknüpfung. Mit `auto_create` an einem öffentlichen
  Provider käme jeder mit dortigem Konto rein (rechtlos) — dann `allowed_domains` setzen.

## Offen / verbesserungswürdig

Kern:
- **JWKS-Signaturprüfung** als Defense-in-Depth; **`azp`** prüfen bei mehreren `aud`.
- **Refresh-Tokens / RP-Logout** (`end_session_endpoint`): nicht implementiert.
- **Apple client_secret-JWT** (ES256) generieren; **Microsoft Multi-Tenant** (`iss` mit
  Tenant-ID) unterstützen.
- **Mehrere parallele Logins** (zwei Tabs) überschreiben den einen Session-Transient →
  Fix: Transient per `state` keyen.

Backend (bewusst schlank):
- Keine `name`-Validierung; doppelter Name → DB-Fehler (500).
- Kein Speichern/Löschen-Feedback, kein „Vorlage vs. konfiguriert"-Badge.

Sonstiges:
- Getestet ist `resolveUser()`/`identity()`; der Callback selbst (Token-Tausch, id_token-Prüfung)
  nur manuell.
