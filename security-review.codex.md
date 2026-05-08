# Security Review

Stand: 2026-05-07

Scope: Deno/Hono-Qino-Code im Workspace, mit Fokus auf `qino/` und die Deno-Server-Einstiege. PHP-Legacy-Code wurde nur als Kompatibilitaetskontext betrachtet.

## Findings

### 1. Kritisch: Remote-Dateiimport erlaubt SSRF, Memory-DoS und potentielles Schreiben ausserhalb von `cache/tmp`

Der CMS-Datei-API-Pfad erlaubt Editors, eine Datei per HTTP(S)-URL hinzuzufuegen: [module/cms/apt.ts](module/cms/apt.ts:405) ruft [module/cms/apt-exports.ts](module/cms/apt-exports.ts:87) auf, wo HTTP(S)-Strings explizit erlaubt werden: [module/cms/apt-exports.ts](module/cms/apt-exports.ts:101). In `DbFile.replaceBy()` wird diese URL serverseitig mit Redirects geladen: [module/core/lib/DbFileManager.ts](module/core/lib/DbFileManager.ts:248). Danach wird der gesamte Body in den Speicher gelesen: [module/core/lib/DbFileManager.ts](module/core/lib/DbFileManager.ts:250).

Zusaetzlich wird `filename="..."` aus `Content-Disposition` direkt fuer den Temp-Pfad verwendet: [module/core/lib/DbFileManager.ts](module/core/lib/DbFileManager.ts:252), [module/core/lib/DbFileManager.ts](module/core/lib/DbFileManager.ts:256), [module/core/lib/DbFileManager.ts](module/core/lib/DbFileManager.ts:257). Ein Server koennte z.B. `filename="../../..."` liefern.

Impact: Ein berechtigter Editor kann den Qino-Server interne Netze/Metadaten-IPs abrufen lassen, grosse Antworten in RAM laden lassen und unter Umstaenden Dateien ausserhalb von `cache/tmp` schreiben, sofern der Prozess Schreibrechte hat.

Empfehlung: URL-Import hinter eine explizite Policy legen, private/loopback/link-local IPs nach DNS-Aufloesung blockieren, Timeouts und Maximalgroessen erzwingen, streaming statt `arrayBuffer()` verwenden, Dateinamen immer mit `basename` normalisieren und per `join`/`normalize` pruefen, dass der Zielpfad im Temp-Verzeichnis bleibt. Besser: `Deno.makeTempFile()` und den Response-Dateinamen nur als DB-Metadatum speichern.

### 2. Hoch: Fresh install erzeugt bekannten Superuser `su`

Bei fehlendem Superuser wird ein Account `su` mit festem bcrypt-Hash angelegt: [module/cms.installation.default/mod.ts](module/cms.installation.default/mod.ts:72), [module/cms.installation.default/mod.ts](module/cms.installation.default/mod.ts:73). Der Health-Check kennt dieses Risiko und prueft explizit auf Passwort `su`: [module/cms.backend.system/health_check.ts](module/cms.backend.system/health_check.ts:88), [module/cms.backend.system/health_check.ts](module/cms.backend.system/health_check.ts:94).

Impact: Jede frische Installation ist bis zur manuellen Aenderung mit bekannten Admin-Zugangsdaten angreifbar.

Empfehlung: Keinen bekannten Hash installieren. Stattdessen ersten Superuser per Setup-Flow erzwingen, einmaliges zufaelliges Initialpasswort nur lokal ausgeben, oder den Account ohne Passwort/inaktiv anlegen.

### 3. Hoch: Stored/Backend-XSS in Suchvorschlaegen

Die CMS-Suche liefert HTML-Fragmente mit DB-Inhalten zurueck. `cmsSearchNodes()` baut `html` aus Titel/Eltern-Titeln ohne `hee`: [module/cms/apt-exports.ts](module/cms/apt-exports.ts:160), [module/cms/apt-exports.ts](module/cms/apt-exports.ts:161). `cmsSearchFiles()` baut `html` aus Dateinamen und Seitentitel ohne `hee`: [module/cms/apt-exports.ts](module/cms/apt-exports.ts:198), [module/cms/apt-exports.ts](module/cms/apt-exports.ts:199). Der Client setzt diese Werte direkt mit `innerHTML`: [module/core/js/qg/c1Combobox.mjs](module/core/js/qg/c1Combobox.mjs:64). Ausgeloest wird das ueber die Page/File-Suchfelder: [module/cms/pub/js/cms.js](module/cms/pub/js/cms.js:102), [module/cms/pub/js/cms.js](module/cms/pub/js/cms.js:109).

Impact: Ein gespeicherter Titel oder Dateiname kann Script im Backend-Kontext ausfuehren. In Kombination mit den APT-Routen kann das schnell zu Account- oder Inhaltsuebernahme werden.

Empfehlung: Entweder keine HTML-Fragmente mehr vom Server liefern und clientseitig mit `textContent` rendern, oder alle dynamischen Teile mit `hee()` escapen. Auch Attribute wie `style="background:url(...)"` nicht aus unescaped Strings bauen.

### 4. Hoch: Git-APT hat zu breite Berechtigungen

Die Git-API notiert selbst: "todo, nur access wenn auf backend module seite access": [module/git/mod.ts](module/git/mod.ts:27). `status`, `log` und `tags` haben keine Login- oder Rechtepruefung: [module/git/mod.ts](module/git/mod.ts:31), [module/git/mod.ts](module/git/mod.ts:40), [module/git/mod.ts](module/git/mod.ts:50). `pull` ist fuer jeden eingeloggten User erlaubt: [module/git/mod.ts](module/git/mod.ts:59), [module/git/mod.ts](module/git/mod.ts:63), [module/git/mod.ts](module/git/mod.ts:66). `push`, `checkout` und `install` pruefen dagegen Superuser: [module/git/mod.ts](module/git/mod.ts:75), [module/git/mod.ts](module/git/mod.ts:87), [module/git/mod.ts](module/git/mod.ts:99).

Impact: Repo-Pfade, Branches, Logs und Dateinamen koennen geleakt werden. Jeder Login kann serverseitig Code aktualisieren, falls ein Modul-Git-Repo konfiguriert ist.

Empfehlung: Alle Git-Routen mindestens an Superuser oder an die Backend-Module-Seitenberechtigung binden. Mutierende Git-Aktionen nur mit Superuser plus CSRF-Token erlauben.

### 5. Mittel: Neue `/api`-APT-Routen haben keinen CSRF-Token-Check

Die REST-API wird global unter `/api` gemountet: [module/core/server.ts](module/core/server.ts:80). Der Adapter liest JSON/Query und ruft direkt `invoke()` auf: [module/core/lib/apt.ts](module/core/lib/apt.ts:202), [module/core/lib/apt.ts](module/core/lib/apt.ts:206), [module/core/lib/apt.ts](module/core/lib/apt.ts:210), [module/core/lib/apt.ts](module/core/lib/apt.ts:211). Die alte `serverInterface`-Schicht prueft dagegen `qgToken`: [module/core/lib/serverInterface.ts](module/core/lib/serverInterface.ts:127), [module/core/lib/serverInterface.ts](module/core/lib/serverInterface.ts:134).

Impact: Mutierende APT-Endpunkte sind nicht an den vorhandenen Anti-CSRF-Mechanismus gebunden. `SameSite=Lax` hilft gegen viele klassische Cross-Site-POSTs, aber nicht gegen Same-Site-Subdomain-Szenarien, Backend-XSS oder zukuenftige Clients, die die API direkt nutzen.

Empfehlung: Fuer `POST`, `PUT`, `PATCH`, `DELETE` ein `qgToken`-Header oder Body-Feld verlangen, alternativ zusaetzlich `Origin`/`Sec-Fetch-Site` pruefen. Den APT-Client entsprechend erweitern.

### 6. Mittel: Demo-Server enthalten feste DB-Zugangsdaten

Die Deno-Server-Beispiele enthalten DB-Namen, User und Passwort im Code: [../demo/server.ts](../demo/server.ts:17), [../demo/server.ts](../demo/server.ts:19), [../demo/server.ts](../demo/server.ts:20), [../demo/server.ts](../demo/server.ts:21), [../demo2/server.ts](../demo2/server.ts:9), [../demo2/server.ts](../demo2/server.ts:13), [../demo2/server.ts](../demo2/server.ts:14).

Impact: Falls diese Dateien deployed, geteilt oder geleakt werden, sind Datenbankzugriffe kompromittiert. Auch fuer lokale Systeme ist das ein Risiko, weil Beispiele oft kopiert werden.

Empfehlung: Credentials aus Env laden, z.B. `DB_NAME`, `DB_USER`, `DB_PASS`, und Demo-Defaults ohne echtes Passwort halten.

### 7. Niedrig: GET-Logout ignoriert ungueltigen Token

Bei Logout per GET wird ein falscher Token nur geloggt, danach aber trotzdem ausgeloggt: [module/core/lib/Auth.ts](module/core/lib/Auth.ts:29), [module/core/lib/Auth.ts](module/core/lib/Auth.ts:30), [module/core/lib/Auth.ts](module/core/lib/Auth.ts:31), [module/core/lib/Auth.ts](module/core/lib/Auth.ts:33).

Impact: Das ist keine Account-Uebernahme, aber ein Cross-Site-Logout/Session-Stoerungsrisiko.

Empfehlung: Bei falschem Token abbrechen, oder Logout nur per POST mit Token erlauben.

## Weitere Beobachtungen

- Der File-Editor ist bewusst maechtig: Superuser koennen beliebige Pfade lesen, erstellen und schreiben: [module/fileEditor/mod.ts](module/fileEditor/mod.ts:59), [module/fileEditor/mod.ts](module/fileEditor/mod.ts:74), [module/fileEditor/mod.ts](module/fileEditor/mod.ts:80), [module/fileEditor/mod.ts](module/fileEditor/mod.ts:96), [module/fileEditor/mod.ts](module/fileEditor/mod.ts:19), [module/fileEditor/mod.ts](module/fileEditor/mod.ts:34). Falls das so bleiben soll, waere eine klare Superuser-only-Grenze plus Audit-Log sinnvoll; falls Session-Allows wieder genutzt werden, Pfade kanonisieren und auf erlaubte Roots begrenzen.
- SQL-Zugriffe sind an vielen Stellen sauber parametrisiert. Die auffaelligeren dynamischen SQL-Stellen sitzen vor allem in Schema/Versions-Code und wirken aktuell eher intern. Bei kuenftigen oeffentlichen APIs fuer Tabellen-/Feldnamen bitte konsequent `Db.escapeId()` verwenden.
