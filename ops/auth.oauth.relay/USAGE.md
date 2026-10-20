# auth.oauth.relay — ein Callback für viele Apps

Beim Provider (Google, Facebook, Apple, GitHub, …) wird nur **eine** Redirect-URI eingetragen. Der
Relay nimmt die Antwort entgegen und leitet sie an die App weiter, die das Login gestartet hat. Neue
Kundendomains brauchen keinen Eintrag beim Provider.

Der Relay speichert nichts und kennt keine Benutzer. Login, Session und Konten bleiben
in `auth.oauth` der jeweiligen App.

## Einrichten

**Relay-App** (z.B. `auth.example.com`): Modul aktivieren und die Provider in `auth.oauth` einrichten wie
in jeder App (gleiche `client_id`/`client_secret`, `redirect_uri` = die Relay-URI). Apps, die mit einem
dieser Secrets signieren, sind damit freigegeben. Für Apps ohne gemeinsames Secret:

| Setting | Bedeutung |
|---|---|
| `hosts` | Hosts, an die weitergeleitet wird, einer pro Zeile; `*.example.ch` deckt Subdomains ab |

**Beim Provider:** als Redirect-URI `https://auth.example.com/oauth/relay` eintragen.

**In jeder App:** beim Provider in `auth.oauth` dieselbe `client_id`/`client_secret` eintragen und
`redirect_uri` auf `https://auth.example.com/oauth/relay` setzen.

## Ablauf

1. `auth.oauth` schickt die Relay-URI als `redirect_uri` und hängt die eigene Callback-URL an `state`
   an, signiert mit dem `client_secret` (`<random>.<base64url(url)>.<hmac>`).
2. Der Provider schickt `code` + `state` an den Relay.
3. Der Relay prüft die Signatur gegen die `client_secret` seiner Provider oder den Host gegen `hosts` (nur `https`) und leitet alle Felder per 303 an die
   Callback-URL der App weiter. Ein POST (Apples `form_post`) wird dabei zum GET, damit der Browser das
   `SameSite=Lax`-Session-Cookie der App mitschickt.
4. Die App prüft `state` gegen ihre Session und tauscht den Code mit derselben `redirect_uri` ein.

## Sicherheit

- Ohne gültige Signatur oder Eintrag in `hosts` keine Weiterleitung — sonst wäre der Relay ein Open
  Redirect. Wer das `client_secret` hat, kann mit dem OAuth-Client ohnehin alles; mehr erlaubt die Signatur nicht.
- Keine Freigabe per DNS („zeigt auf diesen Server"): Relay und Browser lösen getrennt auf, eine
  Angreifer-Domain könnte beiden verschieden antworten (DNS-Rebinding).
- Ziel ist nur ein `…/oauth/callback/<name>` ohne Query: Jede andere Seite eines erlaubten Hosts könnte
  den Code weiterreichen (Referer, eigene Redirects), und ein Angreifer könnte ihn mit seiner eigenen
  Session einlösen.
- Ein abgefangener Code nützt nichts: `state` hängt an der Session der App, bei OIDC zusätzlich PKCE.
- `client_secret` liegt in jeder App und auf dem Relay — gedacht für Apps, die man selbst betreibt.
