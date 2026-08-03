# Coding-rules: offene Arbeiten

Stand 2026-08-03, jeder Punkt am Code nachgeprüft. Was hier nicht mehr steht, ist erledigt oder war
keine Regelverletzung — die geprüften Fehlalarme stehen unten kurz begründet, damit sie nicht wieder
aufgemacht werden.

## Priorität 1

- **Versions-SQL dialektfähig bauen:** MySQL-Backticks und String-Interpolation in
  [Vers.ts createView](module/cms.versions/lib/Vers.ts#L122) (Feldliste, PK-Joins, `CREATE VIEW`-Kopf) und
  [baselineTable](module/cms.versions/lib/Vers.ts#L169) durch `sql.id()`/`sql.join()` ersetzen. Beides geht
  heute als `sql.raw(head + where)` raus und bricht auf Postgres und SQLite.
- **`maintenance.ts` ist komplett MySQL-only:** [thinHistory](module/cms.versions/maintenance.ts#L42) baut den
  ganzen Rumpf als String — `SHOW COLUMNS` statt `db.columns()`, Backticks, das MySQL-eigene
  `DELETE m FROM …` und `GREATEST`/`POW`/`LN` in [bucket()](module/cms.versions/maintenance.ts#L28).
  Auf SQLite/Postgres wirft die History-Wartung.
- **`AUTO_INCREMENT`-Sync dialektfähig machen:** [Spaces.ts](module/cms.versions/lib/Spaces.ts#L88) setzt
  `ALTER TABLE … AUTO_INCREMENT=`. `Db.syncAutoIncrement()` wäre der Weg, ist aber nur im Postgres-Treiber
  implementiert ([DbDriver.ts](module/core/lib/db/DbDriver.ts#L215)) — der MySQL-Treiber braucht dafür zuerst
  ein Override, sonst wird die Umstellung zur stillen No-Op.

## Priorität 2

- **Native Prototype-Erweiterungen ersetzen:** `Text.prototype.closest` in [c1.js](module/core/pub/js/c1.js#L87),
  `Blob.prototype.c1IsImage`/`c1ToImage` in [fileHelpers.mjs](module/core/pub/js/qg/fileHelpers.mjs#L23),
  `Selection.prototype.c1*` in [crossbrowser.mjs](module/core/pub/js/Rte/crossbrowser.mjs#L38) durch Helfer
  ersetzen. Die `Object.assign(X.prototype, c1.Eventer)`-Stellen sind Mixins auf eigenen Klassen und bleiben.
- **Native Backend-Dialoge ersetzen (teils mit deutschen Texten):**
  [imageEditor.js](module/cms.image_editor/pub/imageEditor.js#L29) und
  [imageEditor.js](module/cms.image_editor/pub/imageEditor.js#L110),
  [dbFileImageEditor.js](module/cms.image_editor/pub/dbFileImageEditor.js#L212),
  [SettingsEditor.mjs](module/core/pub/js/SettingsEditor.mjs#L144) (lädt
  [cms.backend.settings](module/cms.backend.settings/plugin.ts#L13) und das Panel),
  [cms.text/init.mjs](module/cms.text/pub/init.mjs#L67).
  Nicht betroffen: `cms.cont.*`-Frontendmodule ohne u2 und alles, was `u2/js/dialog` importiert — dort ist
  `confirm`/`alert` bereits der u2-Dialog.
- **Inline-`<style>`-Blöcke in eigene CSS-Dateien:**
  [cms.backend.system](module/cms.backend.system/plugin.ts#L139) überschreibt global
  `.u2-card { flex-basis:28rem }` und definiert `.healty_container`/`.healty_item` (global, snake_case,
  Tippfehler) mit `grid-gap:8px`; [cms.backend.ai.sessions](module/cms.backend.ai.sessions/plugin.ts#L100)
  definiert `.ai-*` global mit `#fff`/`#999` und px-Abständen. Beides gehört in eine `pub/main.css` mit
  `[qcms-mod="…"]`-Anker, Kurznamen mit `-` und ohne feste Farben.
- **GET-Parameter auf `modulname_camelCase` bringen:** rund 30 Stellen halten die Konvention nicht, u.a.
  [users](module/cms.backend.users/plugin.ts#L17) (`id`, `grp_id`), [mail](module/cms.backend.mail/plugin.ts#L28)
  (`id`, `search`), [superuser.db](module/cms.backend.superuser.db/render.ts#L23) (`view`, `table`),
  [superuser.log](module/cms.backend.superuser.log/plugin.ts#L284) (`id`, `search`, `history_of`),
  [cms.tree](module/cms.backend.cms.tree/plugin.ts#L17) (`rp`), [module](module/cms.backend.module/plugin.ts#L270) (`mod`),
  [ai](module/cms.backend.ai/plugin.ts#L283) (`open`), [ai.sessions](module/cms.backend.ai.sessions/plugin.ts#L95) (`s`),
  [security](module/cms.backend.security/view.ts#L40) (`tab`), [fileEditor](module/fileEditor/plugin.ts#L34)
  (`file`, `line`, `col`), [image_editor](module/cms.image_editor/plugin.ts#L84) (`file_id`),
  [groups](module/cms.backend.groups/plugin.ts#L16) (`id`),
  [domain-monitor](module/cms.backend.domain-monitor/render.ts#L496) (`domain`), [cms](module/cms/plugin.ts#L106) (`replace`),
  [error_report](module/error_report/plugin.ts#L43) (`message`), [oauth](module/oauth/plugin.ts#L82) (`return_to`),
  [table2](module/cms.cont.table2/plugin.ts#L35) (`export_table`).
  Ausgenommen bleiben `cmspid`/`lang`, die OAuth-Callback-Parameter `code`/`state`/`error` und die
  Legacy-Trackinglinks [mail/tracking.ts](module/mail/lib/tracking.ts#L8) (`mail1tr`, `url`).
- **Daten-Interfaces auflösen** (reine Datenformen, keine Verträge): [backend.api](module/cms.backend.api/plugin.ts#L12)
  (`PathParam`, `Route`), [ai/types.ts](module/ai/types.ts#L22) (`ProviderRow`, `ProviderModelRow`),
  [ChatSession](module/ai/lib/ChatSession.ts#L180) (`ToolCall`), [ai registry](module/ai/lib/registry.ts#L7),
  [history](module/cms.backend.cms.history/plugin.ts#L60) (`Event`),
  [tableStatus.ts](module/cms.backend.superuser.db/lib/tableStatus.ts#L3), [Vers.ts](module/cms.versions/lib/Vers.ts#L12)
  (`DbVersState`, `VersState`), [CmsVers.ts](module/cms.versions/lib/CmsVers.ts#L9),
  [DbDriver.ts](module/core/lib/db/DbDriver.ts#L6) (`ExecResult`, `MigrateOptions`),
  [util.ts](module/core/lib/util.ts#L17) (`HeaderBuilders`), [fileStream.ts](module/core/lib/fileStream.ts#L8)
  (`UploadedFile`), [transform/types.ts](module/core/lib/transform/types.ts#L5)
  (`TransformOptions`/`Meta`/`Context`/`Result`, `Transcript*`). Verträge bleiben: `AppEvents`, `DbEvents`,
  `StandardSchema`, `AptNode`/`Verb`/`Route` (apt), `TransformerDef`, `OcrEngine`, `TranscriptEngine`.

## Priorität 3

- **`superuser`-Abfrage entdoppeln:** `!!(await ctx.user?.get("superuser"))` steht 25-mal in 21 Dateien,
  auch im Core ([Access.SUPERUSER](module/core/lib/apt/access.ts#L7), [Ctx.dev](module/core/lib/ctx/Ctx.ts#L39)).
  Eine freie Funktion in core (`isSuperuser(ctx)`) ersetzt alle Vorkommen.
- **Öffentliche Lookup-Konstanten auf `UPPER_SNAKE_CASE`:** [Db.ts](module/core/lib/db/Db.ts#L8)
  (`dateTypes`, `stringTypes`, `numTypes`), [dns.ts](module/cms.backend.domain-monitor/lib/dns.ts#L15) (`types`),
  [monitor.ts](module/cms.backend.domain-monitor/lib/monitor.ts#L5) (`frequencies`). Breaking, aber greppbar.
- **`cms.text/api.ts` aufräumen:** durchgehend `any`, snake_case-Parameter (`text_id`, `target_lang`),
  4er-Einrückung, `boolean`-Rückgaben statt `this | undefined`: [cms.text/api.ts](module/cms.text/api.ts#L17).
- **Lange Parameterlisten durch Optionen-Objekte ersetzen:** [rules.ts signal()](module/cms.backend.security/rules.ts#L55)
  (7 Parameter, fünf davon `string`), [store.ts hitBucket()](module/cms.backend.security/store.ts#L80) (7),
  [Vers.ts createView()](module/cms.versions/lib/Vers.ts#L122) (6), [uncdn fetchAndCache()](module/uncdn/plugin.ts#L76) (5),
  [SessionManager](module/core/lib/SessionManager.ts#L20) (5), [util.ts setCookie()](module/core/lib/util.ts#L19) (5),
  [cms.cont.web_auth renderLogin()](module/cms.cont.web_auth/plugin.ts#L47) (5).
- **Nicht erlaubte `px` ersetzen** — nur noch diese fünf Stellen, alles andere im Projekt ist `1px` oder
  `font-size`: [ai.sessions](module/cms.backend.ai.sessions/plugin.ts#L101),
  [access.time](module/cms.frontend.2/view/widgets/access.time.ts#L35), [system](module/cms.backend.system/plugin.ts#L144),
  [cont.image2](module/cms.cont.image2/plugin.ts#L74), [media_list_trs](module/cms.frontend.2/view/widgets/media_list_trs.ts#L33).
- **Statische sichere HTML-Attribute entquoten:** [imageEditor.js](module/cms.image_editor/pub/imageEditor.js#L1)
  (24 Zeilen), [dbFileImageEditor.js](module/cms.image_editor/pub/dbFileImageEditor.js#L1) (5),
  [chat.js](module/ai/pub/chat.js#L51) (3). Der Rest des Projekts ist sauber.
- **ESM-Hygiene im Altbestand:** `var` in [NodeCleaner.mjs](module/core/pub/js/c1/NodeCleaner.mjs#L120),
  IIFE in [c1.js](module/core/pub/js/c1.js#L1) und [cms-image2.js](module/cms.image2/pub/cms-image2.js#L1).
- **CDN-Import ohne CSP-Eintrag:** [ai/pub/chat.js](module/ai/pub/chat.js#L2) importiert `marked` und
  `DOMPurify` von jsdelivr, aber weder [ai](module/ai/plugin.ts) noch
  [cms.frontend.ai](module/cms.frontend.ai/plugin.ts#L15) trägt die Herkunft in `ctx.res.csp["script-src"]`
  ein. Default ist CSP aus, mit `core.csp.enable` bleibt der Chat also stumm. Alle anderen CDN-Nutzer
  registrieren ihre Quelle ([layout.backend](module/cms.layout.backend/plugin.ts#L17),
  [superuser.state](module/cms.backend.superuser.state/plugin.ts#L32), [core](module/core/plugin.ts#L98)).
  Zu entscheiden: Eintrag nachziehen, über `uncdn` spiegeln oder mitliefern.
- **`bucketWrite` pro App/Db isolieren:** [store.ts](module/cms.backend.security/store.ts#L10) serialisiert über
  einen modulglobalen `Map`-Schlüssel `scope:ident` ohne Db-Bezug — zwei Tenants mit derselben IP warten
  aufeinander. Kein Datenleck, aber Kopplung.
- **`any`-Dichte:** [cms/apt.ts](module/cms/apt.ts#L1) (40 Stellen) und [cms.text/api.ts](module/cms.text/api.ts#L1)
  (17) sind die Ausreisser; 78 Dateien tragen ein pauschales `deno-lint-ignore-file no-explicit-any`.

## Geprüft, kein Handlungsbedarf

- **Multi-Tenant-State:** alle früher gemeldeten Registries sind `WeakMap`-basiert und pro `App`/`Db`
  gekeyt (ai, cms, mail, uncdn, cron, score, vers, accessRules, security-guard). Offen ist nur `bucketWrite`.
- **Prozess-Caches:** [templateParser](module/cms.templateParser/mod.ts#L8) (Pfad + mtime) und
  [oauth discovery](module/oauth/plugin.ts#L17) (öffentliche IdP-Metadaten, Fehlschläge werden nicht gecacht)
  sind tenant-neutral und als solche dokumentiert.
- **Zusätzliche `superuser`-Prüfungen:** die verbliebenen Stellen sind Eskalations- bzw. Systemgrenzen —
  fremdes Superuser-Konto bearbeiten, Module linken/unlinken, App-Dateien schreiben, Serverpfade anzeigen,
  globale Settings „lösen". Keine zusätzlichen Modulgates.
- **Tabellen-Markup:** keine einzige `<tr>`-Zeile mit drei oder mehr Zellen; die einzeiligen `<tr>` haben
  alle zwei kurze Zellen und sind damit erlaubt.
- **Boolean-SQL:** kein `= 1`/`= 0` auf Boolean-Spalten; die Treffer betreffen Integer-Spalten (`sent`,
  `_vers_deleted`, `online_start`, `cms_access`).
- **`readonly` / Constructor-Shorthands:** keine Instanzfelder mit `readonly`, keine
  `public`/`private`-Parameter-Properties.
- **`hee()`-Redundanz:** kein `hee(String(x))` und kein `hee(x ?? "")` — die Treffer sind Argumente für
  Hilfsfunktionen oder Konkatenationen.
- **Benennung:** keine PascalCase-Variablen (die zwei Treffer stehen in auskommentiertem Code), keine
  verschatteten Typ-Importe, keine redundanten `const x: T = new T()`.
- **Sprache:** Kommentare durchgehend englisch; die einzige deutsche UI-Zeichenkette
  (`<div class=-head>Speicher</div>` in cms.backend.system) ist übersetzt.
- **Übrige Dialekt-Abhängigkeiten:** `SHOW TABLE STATUS`/`SHOW INDEX`/`information_schema` sind überall
  sonst sauber nach `db.dialect` verzweigt ([tableStatus.ts](module/cms.backend.superuser.db/lib/tableStatus.ts#L6),
  [statistic.ts](module/cms.backend.system/parts/statistic.ts#L6), [score](module/score/plugin.ts#L44),
  [indexes.ts](module/cms.backend.superuser.db.cleanup/lib/indexes.ts#L4), [db.query](module/cms.backend.superuser.db.query/render.ts#L146))
  oder mit `.catch()` abgesichert. Das ungeschützte `DELETE m FROM … JOIN` in
  [cms.backend.mail](module/cms.backend.mail/plugin.ts#L41) ist auf eine portable Subquery umgestellt.
- **`sql.raw()`:** alle Aufrufe sind Konstanten, Dialektfragmente, Db-Metadaten oder aus einem Ternary
  abgeleitet — keine Stelle mit Benutzereingabe.
- **HTML-Escaping:** die geprüften Interpolationen aus DB-/Benutzerdaten stehen alle in `html`/`html.async`
  und werden damit escaped; kein rohes Template-Literal mit ungeprüften Werten gefunden.
- **Objekt-Bindings in SQL:** `${node}`/`${page}` banden ein Node-Objekt als Parameter (funktioniert nur,
  weil der Treiber `toString()` nimmt — Postgres würde JSON serialisieren). Auf `${node.id}` umgestellt:
  [urls.ts](module/cms.frontend.2/view/widgets/urls.ts#L12), [urls.head.ts](module/cms.frontend.2/view/widgets/urls.head.ts#L6),
  [tree.access](module/cms.backend.cms.tree.access/plugin.ts#L152).
- **`deno lint`:** 107× `no-explicit-any` (siehe oben) und 4× `no-slow-types` (laut Regelwerk bewusst in
  Kauf genommen), sonst nur noch 3× `require-await` an signaturgetriebenen Methoden, 3× `no-import-prefix`
  an Browser-Modulen und 2× `ban-types` in einem Test. `ban-unused-ignore`, `no-empty` und
  `verbatim-module-syntax` sind behoben.
- **`mcp/mod.ts` und `cms.webmcp/mod.ts`:** beide sind in [deno.json](deno.json) als Paket-Einstiegspunkte
  exportiert — die Ein-Funktions-API ist Absicht.
