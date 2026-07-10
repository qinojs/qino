# Review: `module/core`

Stand: 2026-07-10, 4. Fassung. Alle Findings sind gegen den Code verifiziert; erledigte Punkte werden laufend entfernt (siehe git-Historie). Die Nummerierung der Erstfassung bleibt stabil, daher gibt es Lücken.

Bewusste Entscheidungen, nicht erneut aufgreifen:

- `usr.set("lang", …)` in [LangManager.ts](module/core/lib/LangManager.ts#L43) bleibt aus Performance-Gründen absichtlich un-awaited.
- Signatur-Konvention: Existenz-/Lookup-Methoden geben `this | undefined` bzw. `T | undefined` zurück — truthy-prüfbar und chainable (`?.`/`??`), **kein** boolean und kein `| false`.
- Die `| false`-Rückgaben der apt-Endpoints in [cms.text/api.ts](module/cms.text/api.ts#L90) bleiben: `false` geht dort als JSON über die Leitung, Umstellung wäre eine Wire-Format-Änderung.

## Kurzfazit

Der Server-Core hat gute Grundlagen: Web-Standard-`Request`/`Response`, gebundene SQL-Parameter, app-gebundene Manager, eine klare Request-Pipeline und eine grüne Testsuite. Für einen kleinen, konsistenten Profi-Core sind vor kosmetischer Bereinigung diese Grundlagen zu korrigieren:

1. Sicherheits- und Response-Policies müssen für **jede** Response gelten (statisch und dbFile umgehen sie heute).
2. Session/Auth und SQLite-Transaktionen müssen ihre versprochene Semantik auch bei parallelen Requests einhalten.
3. Modul-globaler, tenantabhängiger Zustand (Entry-Registry) muss verschwinden.
4. Der Legacy-Browserblock (`c1`, `Rte`) gehört aus dem Core heraus oder als echtes ESM neu aufgebaut.

## Kritische Findings

### P0.1 – Statische und dbFile-Responses umgehen Response-Policies

Es gibt drei Response-Wege mit unterschiedlicher Policy-Abdeckung:

- **Statisch**: verlässt `handle()` direkt über `#static()` — ohne `action` (also ohne HTTPS-Redirect/HSTS aus [plugin.ts](module/core/plugin.ts#L105)), ohne `respond` (also ohne CSP aus [plugin.ts](module/core/plugin.ts#L143)) und ohne die festen Header aus `#buildResponse()`: [App.ts](module/core/lib/App.ts#L117), [App.ts](module/core/lib/App.ts#L125), [App.ts](module/core/lib/App.ts#L178).
- **dbFile**: `#route()` gibt die Response direkt zurück ([App.ts](module/core/lib/App.ts#L152)). `action` läuft zwar, aber die dort auf `ctx.responseHeaders` gesetzten Header (HSTS!) werden nur von `#buildResponse()` übernommen — sie gehen verloren. `respond` feuert nie.
- **api** ist in Ordnung: apt signalisiert per geworfenem `Output`, der durch `handleError` → `#buildResponse()` läuft und `ctx.responseHeaders` mitnimmt.

`response-ready` ist kein Ersatz: dort ist keine Core-Policy implementiert und die Response ist bereits gebaut.

Empfehlung: Eine einzige Finalisierung für alle Responses. Routing (statisch, dbFile, api, render) liefert nur eine `Response` bzw. Body+Status; danach laufen zentral `ctx.responseHeaders`-Merge, Security-Header und `response-ready`. Der HTTPS-Redirect muss vor der statischen Auslieferung entschieden werden.

### P0.2 – „Stateless Auth" erzeugt trotzdem eine persistente Session

`RequestContext.create()` lädt oder **erzeugt** immer eine Session (DB-Insert in `SessionManager.#create()`): [RequestContext.ts](module/core/lib/RequestContext.ts#L124), [SessionManager.ts](module/core/lib/SessionManager.ts#L78). Erst danach feuert der `authenticate`-Hook: [init.ts](module/core/lib/init.ts#L8). Die Guards danach verhindern nur Cookie-Versand und Session-Touch, nicht den Insert.

Bei API-Key/Bearer-Traffic entsteht so pro Request eine tote `sess`-Zeile — das widerspricht der dokumentierten side-effect-freien Semantik von `ctx.authenticate()`.

Empfehlung: Session lazy laden — erst bei cookiebasierter/anonymer Stateful-Nutzung. `sess` wird `Session | null` statt `null!` ([RequestContext.ts](module/core/lib/RequestContext.ts#L19)); `csrfToken`, `initSettings()` und `LangManager.initCtx()` müssen den null-Fall behandeln.

### P0.3 – Die Default-SQLite-Transaktion ist bei Parallelität nicht isoliert

Der Treiber dokumentiert selbst, dass fremde Requests während eines `await` in dieselbe Transaktion geraten und gemeinsam rollbacken: [DbDriver.ts](module/core/lib/db/DbDriver.ts#L125). Gleichzeitig ist SQLite die Default-Datenbank jeder `App`: [App.ts](module/core/lib/App.ts#L83). „SQLite nur single-user dev/demo" wird vom API-Default nicht erzwungen — das ist ein Datenintegritätsproblem, kein Performance-Trade-off.

Empfehlung: SQLite-Transaktionen über einen Mutex serialisieren und Ownership per `AsyncLocalStorage` erkennen (analog MySQL/PG-Treiber, die das bereits so machen). Test mit zwei überlappenden Requests, einer davon mit Rollback.

### P0.4 – Entry-Klassen sind tenantübergreifender Modul-Globalzustand

Die Registry liegt global im Modul: [DbEntry.ts](module/core/lib/db/DbEntry.ts#L3). `qgEntries.ts` befüllt sie per Import-Side-Effect: [qgEntries.ts](module/core/lib/qgEntries.ts#L64), importiert aus [plugin.ts](module/core/plugin.ts#L3). Registriert ein Plugin eine Tabellenklasse, gilt sie für alle parallelen `App`-/`Db`-Instanzen — direkter Verstoß gegen die Multi-Tenant-Regel des Projekts (AGENTS.md).

Empfehlung: Registry an `Db` (`db.registerEntryClass(...)`), `DbTable.entry()` löst nur über die eigene `Db` auf, `qgEntries` registriert in `init()` statt per Import.

### P0.5 – Jeder eingeloggte Nutzer kann `ctx.dev` aktivieren

`ctx.dev` liest aus schreibbaren User-/Session-Settings: [RequestContext.ts](module/core/lib/RequestContext.ts#L88) (der `todo`-Kommentar benennt das Risiko selbst). Der `ctx-settings`-Endpoint erlaubt jedem Nutzer (`Access.USER`) beliebige Pfade inklusive `core.dev` zu schreiben: [apt.ts](module/core/apt.ts#L113). Im Core markiert `dev` „nur" Übersetzungen und triggert `smalltext`-Inserts, aber andere Module dürfen `ctx.dev` nicht als vertrauenswürdiges Debug-/Disclosure-Signal behandeln.

Empfehlung: `dev` ausschließlich appseitig konfigurieren (`app.dev`) oder als serverseitig autorisierte Capability. Aus dem schreibbaren `ctxSettingsSchema` entfernen.

### P0.6 – Request-Logging kann Secrets und personenbezogene Daten dauerhaft speichern

Core serialisiert standardmäßig den kompletten Body ins Log: [init.ts](module/core/lib/init.ts#L65) — die Key-basierte Redaction (inzwischen erweitert) bleibt eine Substring-Blocklist und damit prinzipiell lückenhaft. Volle URL (inkl. Query-Tokens) und Referer werden in `log_url` persistiert: [init.ts](module/core/lib/init.ts#L84). Die `SELECT`-dann-`INSERT`-Sequenzen für URL/IP/UA sind race-anfällig (Duplikate): [init.ts](module/core/lib/init.ts#L79).

Empfehlung: Standardmäßig nur strukturierte Metadaten loggen; Body-/Query-Logging als Opt-in mit rekursiver, zentraler Redaction-Policy (Allowlist statt Substring-Blocklist). URL/IP/UA per atomarem Upsert.

## Hohe Priorität

### P1.1 – `Output` erkennt Web-`BodyInit` falsch

Jedes Objekt außer `Uint8Array`/`ReadableStream` wird als JSON behandelt: [util.ts](module/core/lib/util.ts#L98). `Blob`, `ArrayBuffer`, `FormData`, `URLSearchParams` werden dadurch falsch serialisiert (`new Output(new Blob(["abc"])).body` → `"{}"`). `Output` ist Teil der Root-API und mit 15 externen Importstellen breit genutzt.

Empfehlung: JSON nicht heuristisch aus `typeof === "object"` ableiten. Alle `BodyInit`-Typen durchreichen und JSON nur für plain objects/arrays — oder explizit `Output.json(value)` von `Output.body(body)` trennen.

### P1.2 – „Standard Schema" ist nicht Standard-Schema-kompatibel

apt akzeptiert nur die konkrete lokale Klasse (`kind`/`shape` sind Pflicht-Properties, echte `StandardSchemaV1`-Objekte passen strukturell nicht): [types.ts](module/core/lib/apt/types.ts#L8). Ein Spec-konformer Validator darf außerdem ein **Promise** zurückgeben; `invoke()` wertet synchron aus — ein Promise hätte weder `issues` noch `value` und ginge still als Erfolg mit `undefined` durch: [invoke.ts](module/core/lib/apt/invoke.ts#L10). `validatePart` filtert Input-Keys über `shapeOf()`, was bei fremden Schemas ein leeres Objekt validieren würde: [invoke.ts](module/core/lib/apt/invoke.ts#L16). Die lokalen Typen lassen `types` und objektförmige Path-Segmente aus ([StandardSchema.ts](module/core/lib/StandardSchema.ts#L12), Referenz: [Standard Schema V1](https://standardschema.dev)).

Empfehlung: Entweder den offiziellen `StandardSchemaV1`-Typ konsumieren und Validation awaiten — oder den eigenen Validator ehrlich `AptSchema` nennen und Introspektion (`kind`, `shape`) als internes Interface führen. Halbe Kompatibilität ist die schlechteste Variante.

### P1.5 – DB-Coercion speichert ungültige Werte still als `0`; Composite-IDs kollidierbar

Numerische Felder: `parseFloat(...) || 0` — Tippfehler, leere Werte, `NaN` werden zu gültigen Nullen, `"12x"` zu `12`: [DbField.ts](module/core/lib/db/DbField.ts#L50). Composite-IDs joinen mit unescaped `-:-`: [DbTable.ts](module/core/lib/db/DbTable.ts#L88); `entryId2Array` prüft die Komponentenanzahl nicht: [DbTable.ts](module/core/lib/db/DbTable.ts#L98).

Empfehlung: Strikte Konvertierung mit Fehler bei ungültigen Werten. Composite-IDs strukturiert halten oder reversibel encodieren (z. B. JSON-Array), nicht über einen frei vorkommenden Separator.

### P1.6 – `DbEntry` mischt Identity Map, Auto-Save und direkte Tabellenwrites

Drei konkurrierende Zustandsmodelle: WeakRef-Identity-Map in `DbTable` ([DbTable.ts](module/core/lib/db/DbTable.ts#L16)), die direkte `DbTable.update()`-Aufrufe nicht invalidieren (Entries bleiben stale); implizites Auto-Save per Microtask ([DbEntry.ts](module/core/lib/db/DbEntry.ts#L96)); `save()` löscht den Dirty-State vor dem möglicherweise fehlschlagenden Update ([DbEntry.ts](module/core/lib/db/DbEntry.ts#L124)). Dazu tote API: `entry(undefined)` wirft hart „not working" mit auskommentiertem Code: [DbTable.ts](module/core/lib/db/DbTable.ts#L268).

Empfehlung (KISS): Identity Map und Auto-Save entfernen. `entry.get()` lädt, `entry.set()` mutiert lokal, `entry.save()` schreibt explizit und behält Dirty-State bei Fehler. Den `entry(undefined)`-Zweig löschen.

### P1.7 – Transform-Cache-Key: für generische Nutzung nicht inhaltsadressiert

Der Key basiert auf Pfad + Dateigröße + Optionen: [FileTransformer.ts](module/core/lib/transform/FileTransformer.ts#L122). Für den Core-Konsumenten `DbFile` ist der Pfad md5-inhaltsadressiert ([DbFileManager.ts](module/core/lib/DbFileManager.ts#L164)) — dort ist der Key korrekt. `FileTransformer` ist aber generisch exportiert und wird von Modulen mit eigenen Pfaden genutzt; dort liefert eine geänderte Datei gleicher Größe ein stale Ergebnis. `knownMime` beeinflusst die Pipeline, ist aber nicht Teil des Keys: [FileTransformer.ts](module/core/lib/transform/FileTransformer.ts#L111).

Empfehlung: Content-Hash (oder dokumentierte Voraussetzung „Pfad ist inhaltsadressiert") plus MIME in den Key.

### P1.8 – File-HTTP weicht von HTTP Semantics ab (Rest)

- Ungültige oder unbefriedigbare Ranges fallen auf `200` komplett zurück statt `416` + `Content-Range: bytes */size`: [DbFileManager.ts](module/core/lib/DbFileManager.ts#L125), [DbFileManager.ts](module/core/lib/DbFileManager.ts#L304).
- `If-Range` wird ignoriert, `If-None-Match` nur als exakter Einzelstring verglichen (keine Listen, kein `W/`).

Referenz: [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html). Empfehlung: Conditional-/Range-Handling in einen kleinen, eigenständig getesteten HTTP-Helper ziehen; `openRange()` unterscheidet „kein Range" / „syntaktisch ungültig" / „unsatisfiable".

### P1.9 – `safeFetch` bleibt Best-Effort gegen SSRF

Die Private-Range-Liste ist unvollständig (es fehlen u. a. 100.64/10, NAT64) und DNS wird **separat** vor `fetch()` aufgelöst — zwischen Prüfung und Verbindung kann anders aufgelöst werden (DNS rebinding/TOCTOU): [fileStream.ts](module/core/lib/fileStream.ts#L58), [fileStream.ts](module/core/lib/fileStream.ts#L72).

Empfehlung: Als Best-Effort-Guard dokumentieren oder mit pinned-IP-Connector härten.

### P1.10 – Pfadfreigabe ist nur lexikalisch und symlink-anfällig

`assertAllowedPath()` prüft `resolve()`/String-Prefix, nicht den realen Pfad — ein Symlink unterhalb eines erlaubten Roots kann nach außen zeigen: [App.ts](module/core/lib/App.ts#L188). Der Root selbst wird durch den `root + sep`-Prefix abgelehnt.

Empfehlung: `realPath()` von Root und Ziel vergleichen (für neue Ziele: realer Parent); API dafür async. Prefix-Checks über `relative()`-Semantik wie in `pubPath()` ([RequestContext.ts](module/core/lib/RequestContext.ts#L156)), das es bereits richtig macht.

### P1.11 – Body-Parsing: doppelte, uneinheitliche MIME-Erkennung

Content-Types per `includes()`: [Body.ts](module/core/lib/Body.ts#L55) — apt hat parallel eine eigene, korrektere JSON-Erkennung (exakter Typ + `+json`): [fetch.ts](module/core/lib/apt/fetch.ts#L51).

Empfehlung: Ein gemeinsamer MIME-Helper für beide Stellen.

### P1.12 – `htmlValue` vertraut jedem Objekt mit `html`-Property

Beliebige Datenobjekte können so Escaping umgehen; der `HtmlString`-Trust-Marker verliert seinen Wert: [util.ts](module/core/lib/util.ts#L56).

Empfehlung: Nur `HtmlString` (und das dokumentierte `html()`-Renderable-Protokoll für `html.async`) ungeescaped akzeptieren. `head`/`content` im `HtmlBuilder` als bewusst trusted dokumentieren.

### P1.13 – `logout`/Auth-Helfer setzen `clientId` voraus

`ctx.client` wirft, wenn kein `clientId` existiert: [RequestContext.ts](module/core/lib/RequestContext.ts#L83). Bei stateless Auth wird `initClient` übersprungen ([init.ts](module/core/lib/init.ts#L9)) — ein Bearer-authentifizierter Aufruf von `POST /api/core/logout` (Access.USER) läuft in `logout()` → `ctx.client` → 500: [auth.ts](module/core/lib/auth.ts#L66). Gleiches Muster in `rememberLogin()`/`login()`.

Empfehlung: Entweder `client` als `null`-fähig modellieren und in den Auth-Helfern behandeln, oder die stateful Endpoints (`logout`, `password`?) für stateless Requests sauber mit 409/400 ablehnen. Passt zum Session-Umbau aus P0.2.

## API, Architektur und Konsistenz

### P2.2 – Klassenoberflächen sind unnötig mutierbar

Öffentlich schreibbar, obwohl intern gekoppelt: App-Konfiguration und Manager ([App.ts](module/core/lib/App.ts#L50)), Session `token`/`id`/`data` ([SessionManager.ts](module/core/lib/SessionManager.ts#L15)), `Db.schema`-Setter ([Db.ts](module/core/lib/db/Db.ts#L39)), `DbFile.vs` ([DbFileManager.ts](module/core/lib/DbFileManager.ts#L143)). Der `DbFile.name`-Setter macht fire-and-forget-I/O: [DbFileManager.ts](module/core/lib/DbFileManager.ts#L157).

Empfehlung: Konfiguration nach Construction readonly, interne Referenzen `#private`, Mutation über kleine Methoden (`await file.rename(name)` statt Setter).

### P2.3 – Lifecycle ist nicht explizit

`App.init()` hat keinen Guard — doppelter Aufruf registriert Init-Hooks/Listener doppelt: [App.ts](module/core/lib/App.ts#L96), [ModuleManager.ts](module/core/lib/ModuleManager.ts#L101). `install()` läuft bei jedem Boot, der Name suggeriert Einmaligkeit: [ModuleManager.ts](module/core/lib/ModuleManager.ts#L129). Ein App-weites `close()` fehlt — item.js-TTL-Timer und Session-Touch-Timer halten den Prozess am Leben (im Smoke-Test bestätigt).

Empfehlung: `created → initialized → closed` mit idempotentem oder klar fehlschlagendem `init()`, `close()`, Background-Task-Tracker. `install` echte Einmaligkeit geben oder in den `init`-Hook mergen.

### P2.4 – Absichtlich kaputte Mitglieder

`DbText.toString()`/`DbTextLang.toString()` werfen immer: [DbTextManager.ts](module/core/lib/DbTextManager.ts#L86), [DbTextManager.ts](module/core/lib/DbTextManager.ts#L117); `DbTable.entry()` trägt den „not working"-Zweig (P1.6). Rückwärtskompatibilität ist laut Aufgabenstellung nicht nötig.

Empfehlung: Löschen statt mitschleppen.

### P2.5 – Event-Typisierung wird durch Catch-all ausgehebelt

`AppEvents` und `DbEvents` erlauben jeden Namen mit beliebigem Record: [App.ts](module/core/lib/App.ts#L46), [Db.ts](module/core/lib/db/Db.ts#L19) — Tippfehler und falsche Payloads bleiben typkorrekt, obwohl die Kommentare Declaration Merging bereits als Erweiterungsweg dokumentieren. Payload-/Eventnamen sind inkonsistent (`File` vs. `dbFile`, `Table`, `session_old`, `dbFile::access` vs. `dbFile-used`).

Empfehlung: Catch-all entfernen, Module erweitern ausschließlich per Declaration Merging. Einheitlich camelCase-Payloads und ein Separator-Schema für Eventnamen.

### P2.6 – Browser-Code ist überwiegend kein sauberes ESM

Der größte strukturelle Fremdkörper ist `pub/js/c1` + `pub/js/Rte`:

- Classic-IIFE mit implizitem globalem `c1`: [c1.js](module/core/pub/js/c1.js#L1); Mutation nativer Prototypen (`Text`, `Blob`, `HTMLImageElement`): [c1.js](module/core/pub/js/c1.js#L86), [fileHelpers.mjs](module/core/pub/js/qg/fileHelpers.mjs#L23).
- Constructor-Function + `globalThis`-Zuweisung statt `class`/Export: [c1Combobox.mjs](module/core/pub/js/qg/c1Combobox.mjs#L15).
- Rte hängt sich an `globalThis`, exportiert keine API, Import nur über Side-Effects: [index.mjs](module/core/pub/js/Rte/index.mjs#L1); `const my = this` ([Rte.ui.mjs](module/core/pub/js/Rte/Rte.ui.mjs#L6), Lint-Fehler).
- `qgfileUpload` ist `async`, wartet den Upload aber nicht ab und liefert kein Ergebnis: [fileHelpers.mjs](module/core/pub/js/qg/fileHelpers.mjs#L1).

Empfehlung: Rte und die generischen `c1`-Utilities in ein eigenes Editor-/UI-Modul verschieben (oder löschen, was ungenutzt ist). Verbleibenden Browser-Core (`qino.js`, `AptClient.js`, `t.mjs` sind bereits sauber) auf explizite Imports/Exports halten; keine Built-in-Prototypen, keine neuen Globals.

### P2.7 – Stil und Typen ohne gemeinsamen Standard

Gemischte Einrückung (2/4 Spaces, z. B. [RequestContext.ts](module/core/lib/RequestContext.ts) vs. [App.ts](module/core/lib/App.ts)) und Quotes; deutsche Reste in Kommentaren, z. B. [plugin.ts](module/core/plugin.ts#L79), [auth.ts](module/core/lib/auth.ts#L55). Zahlreiche Dateien deaktivieren `no-explicit-any` fileweit statt an der Grenze zu typisieren: [ModuleManager.ts](module/core/lib/ModuleManager.ts#L1), [DbFileManager.ts](module/core/lib/DbFileManager.ts#L1), [Db.ts](module/core/lib/db/Db.ts#L1). `deno lint module/core`: 16 Fehler, davon 13 im Produktivcode.

Empfehlung: Ein Stil, englische Kommentare, keine fileweiten Lint-Ausnahmen. An DB-/Item-Grenzen `unknown`, `Row`, `JsonValue` und kleine strukturelle Interfaces.

## Empfohlene Zielstruktur

Kleinste sinnvolle Trennung (erst **nach** Korrektur der Semantik umsetzen, sonst wird nur fehlerhafter Code verschoben):

```text
module/core/
├── mod.ts                 # explizite Runtime-API + kleine Introspektions-SPI
├── plugin.ts              # Manifest, keine Import-Side-Effects
├── lib/
│   ├── app/               # App, RequestContext, Pipeline mit einer Response-Finalisierung
│   ├── http/              # Req, Body, Output, conditional/range Helper
│   ├── auth/              # Auth + lazy Session
│   ├── db/                # Db/Driver/Table/Entry, Entry-Registry pro Db
│   ├── apt/               # Router, Schema-Consumer, walk/toTools
│   ├── file/              # DbFile, Streams, safeFetch
│   └── transform/         # Pipeline + Engines
└── pub/js/
    ├── qino.js            # Browser-Context (bereits sauber)
    ├── AptClient.js
    └── t.mjs
```

Rte, Combobox und die `c1`-DOM-Utilities gehören nicht in den Laufzeit-Core.

## Umbau-Reihenfolge

1. Integrationstests für alle vier Response-Zweige (static/dbFile/api/render), stateless Auth und parallele SQLite-Transaktionen ergänzen.
2. Einheitliche Response-Finalisierung und lazy Session implementieren (P0.1, P0.2, P1.13).
3. Entry-Registry pro `Db`; SQLite-Mutex; strikte Feldkonvertierung (P0.4, P0.3, P1.5).
4. Logging-, `ctx.dev`-, SSRF-, Pfad- und File-HTTP-Grenzen korrigieren (P0.5, P0.6, P1.8–P1.10).
5. Schema-Frage entscheiden (echtes Standard Schema vs. ehrliches `AptSchema`) und apt-Typen ohne `any` (P1.2).
6. Lifecycle und Mutabilität schließen (P2.2, P2.3).
7. Browser-Legacy auslagern/löschen (P2.6).
8. Zuletzt Namen, Stil, Kommentare, tote Mitglieder (P2.4, P2.5, P2.7).

## Fehlende Tests mit hohem Wert

- Static/dbFile/api/render: identische Security-Header und `response-ready` für jeden Zweig.
- Stateless Credential: kein Session-Insert, kein Cookie; `logout`/`password` stateless.
- Zwei parallele SQLite-Transaktionen mit Commit/Rollback-Isolation.
- Zwei Apps mit unterschiedlichen Entry-Klassen für denselben Tabellennamen.
- `Output` mit allen Web-`BodyInit`-Varianten.
- Externe synchrone und asynchrone `StandardSchemaV1`-Validatoren (je nach Entscheidung in P1.2).
- Regressionstests für die bereits umgesetzten Quick-Fixes: Query-Params mit Prototyp-Namen, ungültiger `Content-Length`, quoted ETag + 304 mit ETag, Transform-Dependency-Cycle, Translation-Import nach warmem Cache.
- Transform: gleicher Pfad/gleiche Größe/neuer Inhalt.
- `If-None-Match`-Listen, `If-Range`, satisfiable/unsatisfiable/suffix Range.
- Symlink-Escape für `assertAllowedPath`; SSRF mit kontrolliertem Resolver.
- Browser-Smoke-Test: jeder ESM-Entry importierbar ohne implizite Globals.

## Verifikation

- Volle Testsuite (`deno task test`): **183 passed, 0 failed**; `deno check` grün über alle Modul-Entries.
- `deno lint module/core`: 16 vorbestehende Findings (P2.7).
- End-to-End-Smoke gegen echte App (SQLite): Page-Render, api mit CSRF, dbFile ETag/304/Range, Translation-Import auf warmem Cache — grün.
- `deno fmt` gemäß Projektanweisung nicht ausgeführt.
