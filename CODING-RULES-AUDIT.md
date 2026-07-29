# Coding-rules audit

Stand: 2026-07-29. Geprüft wurden alle aktiven `*.ts`, `*.js`, `*.mjs`, `*.css` und `*.html` unter `module/` einschließlich Tests sowie die Root-Einstiegspunkte. `nux/`, Binärdateien, SVGs, JSON-Schemata und Lockfiles sind kein handgeschriebener Programmcode und deshalb nicht Teil dieses Stil-Audits.

Die risikolosen Korrekturen sind bereits im Code. Dieser Bericht enthält nur Punkte, die Kompatibilität, HTML-Ausgabe, öffentliche APIs, Berechtigungen oder Struktur berühren und deshalb einen eigenen Umbau brauchen.

## 1. Multi-Tenant-State — hohe Priorität

Die Regel verlangt State an `App`/`Db`/`Ctx`, nicht in Modul-Globals. Auch `WeakMap<App, …>` trennt Tenants technisch, liegt aber weiterhin außerhalb der `App` und erschwert Lebenszyklus und Tests.

- Instanz-Registries: [ai/lib/AiApi.ts](module/ai/lib/AiApi.ts#L14), [cms/lib/CMS.ts](module/cms/lib/CMS.ts#L6), [mail/lib/MailManager.ts](module/mail/lib/MailManager.ts#L16), [uncdn/internal.ts](module/uncdn/internal.ts#L4).
- App-/Db-gebundene Laufzeit-Registries: [cron/scheduler.ts](module/cron/scheduler.ts#L9), [score/mod.ts](module/score/mod.ts#L25), [cms.versions/lib/Vers.ts](module/cms.versions/lib/Vers.ts#L17), [cms.accessRules/lib/standards.ts](module/cms.accessRules/lib/standards.ts#L4).
- Security-Caches: [cms.backend.security/guard.ts](module/cms.backend.security/guard.ts#L7), [cms.backend.security/store.ts](module/cms.backend.security/store.ts#L7). Besonders `bucketWrite` ist nur nach `scope + ident` serialisiert und enthält keinen App-/Db-Anteil; identische Buckets verschiedener Tenants können sich gegenseitig blockieren ([store.ts](module/cms.backend.security/store.ts#L10)).
- Template-Cache und Watcher sind pro Prozess und haben keinen App-Lebenszyklus; der Kommentar erklärt das Teilen zwar für sicher, die Watcher werden beim Unlink aber nicht über das Modul-Signal beendet: [cms.templateParser/plugin.ts](module/cms.templateParser/plugin.ts#L9).
- Der OIDC-Discovery-Cache ist ebenfalls mutable Prozess-State. Inhaltlich ist das Teilen nach Issuer plausibel, sollte aber bewusst als Infrastruktur-Cache gekapselt werden: [oauth/plugin.ts](module/oauth/plugin.ts#L16).

Empfehlung: Instanzen direkt an `App`, Db-spezifische Registries an `Db`, Modul-Caches in einen beim `init()` erzeugten App-State. Dabei Tests von Deep-Imports der WeakMaps auf echte App-Initialisierung umstellen.

## 2. SQL und Dialekte — hohe Priorität

- Der View-Builder der Versionsverwaltung konstruiert SQL mit MySQL-Backticks und Stringinterpolation und reicht das Ergebnis anschließend komplett an `sql.raw()`: [cms.versions/lib/Vers.ts](module/cms.versions/lib/Vers.ts#L130), [cms.versions/lib/Vers.ts](module/cms.versions/lib/Vers.ts#L142), [cms.versions/lib/Vers.ts](module/cms.versions/lib/Vers.ts#L157). Das umgeht Dialekt-Rendering und Identifier-Quoting; für PostgreSQL/SQLite muss der Builder aus `sql`, `sql.id()` und `sql.join()` entstehen.
- Derselbe Bereich baut Primary-Key-Joins als Strings und injiziert sie roh: [cms.versions/lib/Vers.ts](module/cms.versions/lib/Vers.ts#L169). Das sollte eine Liste aus `Sql`-Fragmenten sein.
- MySQL-spezifische `AUTO_INCREMENT`-Statements werden auch in generischem Versionscode erzeugt und der Zahlenwert wird roh eingesetzt: [cms.versions/lib/Spaces.ts](module/cms.versions/lib/Spaces.ts#L73). Hier braucht es einen Dialektzweig oder `Db.syncAutoIncrement()`.
- Der DbFile-Browser setzt qualifizierte Spalten und eine komplette `ORDER BY`-Klausel über `sql.raw()`: [cms.backend.superuser.dbfiles/plugin.ts](module/cms.backend.superuser.dbfiles/plugin.ts#L65), [cms.backend.superuser.dbfiles/plugin.ts](module/cms.backend.superuser.dbfiles/plugin.ts#L73), [cms.backend.superuser.dbfiles/plugin.ts](module/cms.backend.superuser.dbfiles/plugin.ts#L87). Die Eingaben sind aktuell intern/allowlisted, aber Identifier sollten aus `sql.id()`-Fragmenten zusammengesetzt werden.
- Die Query-Konsole verwendet `sql.raw(text)` absichtlich, weil ihr Produktzweck das Ausführen eingegebener SQL-Statements ist: [cms.backend.superuser.db.query/render.ts](module/cms.backend.superuser.db.query/render.ts#L72). Das ist eine dokumentierte Escape-Hatch-Ausnahme, kein normaler Query-Baustein.

## 3. GET-Parameter — brechende URL-Umstellung

Viele produktive Parameter erfüllen `modulname_camelCase` nicht. Eine direkte Umbenennung würde gespeicherte Links, Browser-History und teils E-Mail-Links brechen. Sinnvoll ist eine Übergangsphase: neuen Namen schreiben, alten Namen noch lesen.

- `file`, `line`, `col`: [fileEditor/plugin.ts](module/fileEditor/plugin.ts#L33), [fileEditor/view/codemirror.ts](module/fileEditor/view/codemirror.ts#L61).
- `message`: [error_report/plugin.ts](module/error_report/plugin.ts#L42).
- `id`, `search`: [cms.backend.mail/plugin.ts](module/cms.backend.mail/plugin.ts#L27), [cms.backend.mail.templates/plugin.ts](module/cms.backend.mail.templates/plugin.ts#L28), [cms.backend.smalltext/plugin.ts](module/cms.backend.smalltext/plugin.ts#L85), [cms.backend.groups/plugin.ts](module/cms.backend.groups/plugin.ts#L15), [cms.backend.users/plugin.ts](module/cms.backend.users/plugin.ts#L16), [cms.backend.superuser.log/plugin.ts](module/cms.backend.superuser.log/plugin.ts#L175).
- `rp`: [cms.backend.cms.tree/plugin.ts](module/cms.backend.cms.tree/plugin.ts#L16), [cms.backend.cms.tree.access/plugin.ts](module/cms.backend.cms.tree.access/plugin.ts#L21).
- `view`, `table`: [cms.backend.superuser.db/render.ts](module/cms.backend.superuser.db/render.ts#L23).
- `mod`: [cms.backend.module/plugin.ts](module/cms.backend.module/plugin.ts#L264), [cms.backend.cms.module/plugin.ts](module/cms.backend.cms.module/plugin.ts#L278).
- `s`, `tab`, `open`, `domain`, `file_id`, `grp_id`: [cms.backend.ai.sessions/plugin.ts](module/cms.backend.ai.sessions/plugin.ts#L94), [cms.backend.security/view.ts](module/cms.backend.security/view.ts#L39), [cms.backend.ai/plugin.ts](module/cms.backend.ai/plugin.ts#L282), [cms.backend.domain-monitor/render.ts](module/cms.backend.domain-monitor/render.ts#L496), [cms.image_editor/plugin.ts](module/cms.image_editor/plugin.ts#L83), [cms.backend.users/plugin.ts](module/cms.backend.users/plugin.ts#L50).
- `replace` und `export_table`: [cms/plugin.ts](module/cms/plugin.ts#L103), [cms.cont.table2/plugin.ts](module/cms.cont.table2/plugin.ts#L34).
- `return_to`: [oauth/plugin.ts](module/oauth/plugin.ts#L81).
- Mail-Tracking `mail1tr`/`url` ist besonders kompatibilitätssensitiv, weil die Parameter in bereits versandten E-Mails stehen: [mail/lib/tracking.ts](module/mail/lib/tracking.ts#L8).
- Log-History `history_of`: [cms.backend.superuser.log/plugin.ts](module/cms.backend.superuser.log/plugin.ts#L283).

`cmspid` und `lang` sind laut Regel explizite Ausnahmen. `cms_noFrontend`, `cms_nodeFilesZip` und `cms_versions_*` sind bereits namensräumig.

## 4. Standard-ESM-Hygiene — größerer Frontend-Umbau

Folgende `.mjs`/`.js`-Dateien verwenden weiterhin Prototype-Zuweisungen oder `var`:

- [cms/pub/js/cms.mjs](module/cms/pub/js/cms.mjs#L67), [cms.frontend.2/pub/js/panel.mjs](module/cms.frontend.2/pub/js/panel.mjs#L196), [cms.frontend.2/pub/js/rte.mjs](module/cms.frontend.2/pub/js/rte.mjs#L330), [cms.filebrowser/pub/init.mjs](module/cms.filebrowser/pub/init.mjs#L187), [cms.versions/pub/vers.mjs](module/cms.versions/pub/vers.mjs#L137).
- Native Prototypen werden erweitert in [core/pub/js/c1.js](module/core/pub/js/c1.js#L87), [core/pub/js/qg/fileHelpers.mjs](module/core/pub/js/qg/fileHelpers.mjs#L23) und [core/pub/js/Rte/crossbrowser.mjs](module/core/pub/js/Rte/crossbrowser.mjs#L38). Das ist global wirksam und sollte durch exportierte Helfer ersetzt werden.
- `var`-Altbestand: [core/pub/js/Rte/Rte.mjs](module/core/pub/js/Rte/Rte.mjs#L60), [core/pub/js/c1/NodeCleaner.mjs](module/core/pub/js/c1/NodeCleaner.mjs#L120).
- `HTMLParser` und `CmsVersViewer` sind PascalCase-Constructor-Funktionen statt Klassen/normaler ESM-Exporte: [core/pub/js/Rte/htmlparser.mjs](module/core/pub/js/Rte/htmlparser.mjs#L23), [cms.versions/pub/vers.mjs](module/cms.versions/pub/vers.mjs#L19).

Die bewussten `globalThis`-Exporte im alten Client wurden nicht automatisch entfernt; sie brauchen eine Kompatibilitätsentscheidung pro API.

## 5. Typen und öffentliche APIs

Die ausdrücklich erlaubten Vertrags-Interfaces (`AppEvents`, `DbEvents`, `StandardSchema`, `AptNode`, `Verb`, Router-/Engine-Verträge) bleiben außen vor. Reine Datenformen, die gegen die Interface-Regel verstoßen, sind:

- Interne UI-/Registry-Daten: [cms.backend.api/plugin.ts](module/cms.backend.api/plugin.ts#L12), [ai/lib/registry.ts](module/ai/lib/registry.ts#L7), [ai/lib/ChatSession.ts](module/ai/lib/ChatSession.ts#L180), [cms.backend.cms.history/plugin.ts](module/cms.backend.cms.history/plugin.ts#L59).
- DB-/State-Daten: [ai/types.ts](module/ai/types.ts#L22), [cms.backend.superuser.db/lib/tableStatus.ts](module/cms.backend.superuser.db/lib/tableStatus.ts#L3), [cms.versions/lib/Vers.ts](module/cms.versions/lib/Vers.ts#L12), [cms.versions/lib/CmsVers.ts](module/cms.versions/lib/CmsVers.ts#L9), [core/lib/db/DbDriver.ts](module/core/lib/db/DbDriver.ts#L6).
- Transform-Daten ohne Verhalten: `TransformOptions`, `TransformMeta`, `TranscriptWord`, `TranscriptSegment`, `Transcript`, `TransformResult` in [core/lib/transform/types.ts](module/core/lib/transform/types.ts#L5). Die Engine-/Transformer-Interfaces in derselben Datei sind echte Verträge.
- Upload-Daten: [core/lib/fileStream.ts](module/core/lib/fileStream.ts#L4).

Diese Typen sind teilweise öffentlich exportiert. Ein Wechsel zu Typ-Alias/Inline-Form ist zur Laufzeit sicher, kann aber Declaration-Merging externer Nutzer brechen und wurde deshalb nicht automatisch gemacht.

Öffentliche konstante Lookup-Sammlungen sind noch kleingeschrieben: [core/lib/db/Db.ts](module/core/lib/db/Db.ts#L8), [cms.backend.domain-monitor/lib/dns.ts](module/cms.backend.domain-monitor/lib/dns.ts#L15), [cms.backend.domain-monitor/lib/monitor.ts](module/cms.backend.domain-monitor/lib/monitor.ts#L4). Ihre Umbenennung ist ein API-Bruch. Loader-Verträge wie `settingsSchema`, `ctxSettingsSchema` und `dbSchema` sind bewusst keine `UPPER_SNAKE_CASE`-Kandidaten.

## 6. HTML

### Mehrspaltige Tabellenzeilen

Mehrere Templates schreiben mehrere Zellen derselben Zeile weiterhin kompakt auf eine Quellzeile. Eine reine Umformatierung verändert bei Template-Strings das ausgegebene Whitespace und wurde daher nicht als hundertprozentig risikolos eingestuft.

Betroffen sind:

- [cms.backend.cms.module/plugin.ts](module/cms.backend.cms.module/plugin.ts#L227), [cms.backend.cms.tree/plugin.ts](module/cms.backend.cms.tree/plugin.ts#L75), [cms.backend.domain-monitor/render.ts](module/cms.backend.domain-monitor/render.ts#L83), [cms.backend.mail/plugin.ts](module/cms.backend.mail/plugin.ts#L258), [cms.backend.mail.templates/plugin.ts](module/cms.backend.mail.templates/plugin.ts#L193), [cms.backend.module/plugin.ts](module/cms.backend.module/plugin.ts#L138), [cms.backend.settings/plugin.ts](module/cms.backend.settings/plugin.ts#L25), [cms.backend.smalltext/plugin.ts](module/cms.backend.smalltext/plugin.ts#L118).
- [cms.backend.superuser.dbfiles.transform/plugin.ts](module/cms.backend.superuser.dbfiles.transform/plugin.ts#L247), [cms.backend.superuser.dbfiles/plugin.ts](module/cms.backend.superuser.dbfiles/plugin.ts#L220), [cms.backend.superuser.error_report/plugin.ts](module/cms.backend.superuser.error_report/plugin.ts#L385), [cms.backend.superuser.log/plugin.ts](module/cms.backend.superuser.log/plugin.ts#L222), [cms.backend.superuser.score.test/render.ts](module/cms.backend.superuser.score.test/render.ts#L86), [cms.backend.superuser.uncdn/plugin.ts](module/cms.backend.superuser.uncdn/plugin.ts#L102), [cms.backend.superuser.versions.cms/plugin.ts](module/cms.backend.superuser.versions.cms/plugin.ts#L52).
- [cms.backend.system/plugin.ts](module/cms.backend.system/plugin.ts#L223), [cms.backend.system/parts/statistic.ts](module/cms.backend.system/parts/statistic.ts#L101), [cms.backend.users/plugin.ts](module/cms.backend.users/plugin.ts#L126), [cms.backend.web_auth/plugin.ts](module/cms.backend.web_auth/plugin.ts#L35), [cms.cont.trash/plugin.ts](module/cms.cont.trash/plugin.ts#L32), [cms.cont.web_auth/plugin.ts](module/cms.cont.web_auth/plugin.ts#L55), [cms.cont.my.debug/plugin.ts](module/cms.cont.my.debug/plugin.ts#L12).
- [cms.frontend.2/view/widgets/extended.ts](module/cms.frontend.2/view/widgets/extended.ts#L31), [cms.frontend.2/view/widgets/tree.ts](module/cms.frontend.2/view/widgets/tree.ts#L25), [cms.frontend.2/view/widgets/txts.ts](module/cms.frontend.2/view/widgets/txts.ts#L9), [cms.frontend.2/pub/js/frontend2/clipboard.mjs](module/cms.frontend.2/pub/js/frontend2/clipboard.mjs#L14), [cms.image_editor/pub/imageEditor.js](module/cms.image_editor/pub/imageEditor.js#L160), [core/pub/js/Rte/Rte.ui.items.mjs](module/core/pub/js/Rte/Rte.ui.items.mjs#L268).

### Attribute und Dialoge

- Sicher unquotierbare statische Attribute stehen noch in Anführungszeichen, konzentriert in [ai/pub/chat.js](module/ai/pub/chat.js#L1), [cms.frontend.2/pub/js/browserCheck.js](module/cms.frontend.2/pub/js/browserCheck.js#L1), [cms.frontend.2/pub/js/frontend.mjs](module/cms.frontend.2/pub/js/frontend.mjs#L1), [cms.image_editor/pub/imageEditor.js](module/cms.image_editor/pub/imageEditor.js#L1), [core/pub/js/SettingsEditor.mjs](module/core/pub/js/SettingsEditor.mjs#L1), [core/pub/js/c1/loading.mjs](module/core/pub/js/c1/loading.mjs#L1) und [core/pub/js/c1/tableHandles.mjs](module/core/pub/js/c1/tableHandles.mjs#L1). Das Ändern kann String-/Snapshot-Tests berühren.
- `cms.text` verwendet in der Backend-Bearbeitung native, nicht awaitbare `alert()`-Dialoge: [cms.text/pub/init.mjs](module/cms.text/pub/init.mjs#L67). Der Image-Editor verwendet native `alert()`/`confirm()` und zugleich hartcodierte deutsche Texte: [cms.image_editor/pub/imageEditor.js](module/cms.image_editor/pub/imageEditor.js#L30), [cms.image_editor/pub/dbFileImageEditor.js](module/cms.image_editor/pub/dbFileImageEditor.js#L212). Diese sollten auf die scoped u2-Dialoge umgestellt werden.
- Die übrigen Backend-Aufrufe mit `await alert/confirm/prompt` sind die u2-Dialoge und damit regelkonform. Native Dialoge in normalen Frontend-Content-Modulen fallen nicht unter die Backend-Regel.

Ein nacktes `${node}` innerhalb eines `html.async`-Fragments wurde nicht gefunden. Die gleichnamigen Treffer in `urls*.ts` sind SQL-Interpolationen und nutzen bewusst `Node.toString()`.

## 7. CSS

- Nicht erlaubte `px`-Nutzung außerhalb dünner Linien, Fontgrößen, E-Mail-HTML oder echter Bildpixel: [fileEditor/view/codemirror.ts](module/fileEditor/view/codemirror.ts#L65), [cms.cont.image2/plugin.ts](module/cms.cont.image2/plugin.ts#L73), [cms.backend.ai.sessions/plugin.ts](module/cms.backend.ai.sessions/plugin.ts#L100), [cms.backend.system/plugin.ts](module/cms.backend.system/plugin.ts#L142), [cms.backend.superuser.db/pub/main.css](module/cms.backend.superuser.db/pub/main.css#L12), [cms.frontend.2/pub/css/inline.css](module/cms.frontend.2/pub/css/inline.css#L52), [cms.layout.backend/pub/main.css](module/cms.layout.backend/pub/main.css#L23), [cms.backend.ai/plugin.ts](module/cms.backend.ai/plugin.ts#L361), [cms.backend.users/plugin.ts](module/cms.backend.users/plugin.ts#L124), [cms.frontend.2/view/widgets/access.time.ts](module/cms.frontend.2/view/widgets/access.time.ts#L35), [cms.frontend.2/view/widgets/media_list_trs.ts](module/cms.frontend.2/view/widgets/media_list_trs.ts#L33), [core/pub/js/Rte/main.css](module/core/pub/js/Rte/main.css#L38).
- Zwei Kurzklassen sind ohne Anker global: [cms.frontend.2/view/widgets/access.time.ts](module/cms.frontend.2/view/widgets/access.time.ts#L37). Sie sollten unter `.access-time-manager` verankert werden.
- `font-size: Npx` sowie `1px`-Border/Outline wurden gemäß den expliziten Ausnahmen nicht beanstandet. Ebenso bleiben die erzeugten Bildmaße in `cms.image2` in Pixeln.

## 8. Kontrollfluss, Redundanz und API-Form

- `cms.text/api.ts` ist der größte zusammenhängende Altbestand: viele `any`, Snake-Case-Variablen, fünf positionale Parameter, lange `this.ctx.app…`-Ketten und inkonsistente Einrückung: [cms.text/api.ts](module/cms.text/api.ts#L6), [cms.text/api.ts](module/cms.text/api.ts#L53), [cms.text/api.ts](module/cms.text/api.ts#L126). Das sollte als eigener, getesteter Umbau behandelt werden.
- Fünf bis sieben positionale Parameter statt Optionen-Objekt: Versions-View [cms.versions/lib/Vers.ts](module/cms.versions/lib/Vers.ts#L122), Versions-Copy [cms.versions/lib/CmsVers.ts](module/cms.versions/lib/CmsVers.ts#L56), Security-Signale/Buckets [cms.backend.security/rules.ts](module/cms.backend.security/rules.ts#L55), [cms.backend.security/store.ts](module/cms.backend.security/store.ts#L80), Uncdn-Download [uncdn/plugin.ts](module/uncdn/plugin.ts#L75), Session-Konstruktor [core/lib/SessionManager.ts](module/core/lib/SessionManager.ts#L20), Cookie-Builder [core/lib/util.ts](module/core/lib/util.ts#L19).
- Wiederholte lange Db-Ketten bestehen noch in einzelnen Funktionen, besonders [cms.backend.superuser.score/render.ts](module/cms.backend.superuser.score/render.ts#L22), [cms.image_editor/lib/service.ts](module/cms.image_editor/lib/service.ts#L16), [cms.versions/serverInterface.ts](module/cms.versions/serverInterface.ts#L89) und [cms.text/api.ts](module/cms.text/api.ts#L24). Lokale Aliase sollten beim jeweiligen Umbau konsistent pro Funktion eingeführt werden.
- `mcpFetch` und `webmcpTools` liegen in `mod.ts`, werden derzeit aber nur vom eigenen `plugin.ts` und Tests benutzt: [mcp/mod.ts](module/mcp/mod.ts#L18), [cms.webmcp/mod.ts](module/cms.webmcp/mod.ts#L5). Entscheiden, ob dies wirklich öffentliche API ist; sonst in ein internes Modul verschieben.

## 9. Zusätzliche Superuser-Prüfungen

Die Regel „Modulzugriff bedeutet Nutzungsrecht“ kollidiert mit mehreren inneren Rollenprüfungen. Einige schützen echte Ressourcen-Eigentümerschaft oder Rollen-Eskalation und könnten fachlich gewollt sein; deshalb keine automatische Entfernung.

Prüfstellen: [fileEditor/plugin.ts](module/fileEditor/plugin.ts#L10), [cms.backend.module/plugin.ts](module/cms.backend.module/plugin.ts#L44), [cms.backend.smalltext/plugin.ts](module/cms.backend.smalltext/plugin.ts#L17), [cms.frontend.2/view/widgets/extended.ts](module/cms.frontend.2/view/widgets/extended.ts#L18), [cms.frontend.2/view/widgets/settings.ts](module/cms.frontend.2/view/widgets/settings.ts#L54), [cms.frontend.2/view/widgets/superuser.ts](module/cms.frontend.2/view/widgets/superuser.ts#L30), [cms.backend.users/nodeApi.ts](module/cms.backend.users/nodeApi.ts#L11), [cms.backend.users/plugin.ts](module/cms.backend.users/plugin.ts#L159), [cms.backend.groups/nodeApi.ts](module/cms.backend.groups/nodeApi.ts#L6), [cms.backend.system/healthChecks.ts](module/cms.backend.system/healthChecks.ts#L58), [mail/healthChecks.ts](module/mail/healthChecks.ts#L27).

Ownershipsprüfungen wie „eigener API-Key oder Superuser“ sowie die konfigurierbare Uncdn-Fetch-Policy sind keine redundanten Modulzugriffsprüfungen und wurden nicht beanstandet.

## 10. Bewusst nicht angefasst

- Nullspalten-Markierungen, auskommentierter Code, `zzz` und `(> 1.0)` wurden gemäß Regel vollständig erhalten. Auffällige Stellen: [core/lib/apt/toTools.ts](module/core/lib/apt/toTools.ts#L41), [core/lib/transform/FileTransformer.ts](module/core/lib/transform/FileTransformer.ts#L113), [core/pub/js/Rte/Rte.mjs](module/core/pub/js/Rte/Rte.mjs#L134), [core/pub/js/Rte/crossbrowser.mjs](module/core/pub/js/Rte/crossbrowser.mjs#L9).
- Debug-Ausgaben und bestehende Kommentare wurden nicht entfernt.
- Keine automatisch erzeugte Formatierung und insbesondere kein `deno fmt` wurde ausgeführt.
