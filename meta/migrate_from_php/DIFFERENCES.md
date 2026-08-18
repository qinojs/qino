# Unterschiede PHP → Deno

### Module Migration

## Globale Ersetzungen

`G()` war ein Request-globales `stdClass`-Singleton (via `static`). Properties:

| PHP                       | Deno                                                                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `D()`                     | `app.db`                                                                                                                                 |
| `G()->SET`                | `ctx.settings` und `app.settings`                                                                                                        |
| `G()->Answer`             | `ctx.state.Answer`                                                                                                                       |
| `G()->csp`                | `ctx.csp`                                                                                                                                |
| `G()->csp_report_uri`     | `ctx.cspReportUri`                                                                                                                       |
| `G()->js_data`            | `ctx.state.js_data`                                                                                                                      |
| `Usr()`                   | `ctx.user` / ctx.userId                                                                                                                  |
| `Sess()`                  | `ctx.sess`/ ctx.sessId                                                                                                                   |
| `liveClient::$id`         | `ctx.clientId`                                                                                                                           |
| `liveLog::$id`            | `ctx.logId`                                                                                                                              |
| `$_SESSION`               | `ctx.session` (item.js — siehe [Item.js-Pattern](#itemjs-pattern))                                                                       |
| `$_GET`                   | `ctx.get`                                                                                                                                |
| `$_POST`                  | `ctx.post`                                                                                                                               |
| `$_FILES`                 | `ctx.files`                                                                                                                              |
| `$_COOKIE`                | `ctx.cookie`                                                                                                                             |
| `qg::on()` / `qg::fire()` | `app.on()` / `app.fire()`                                                                                                                |
| `qg::token()`             | `ctx.token`                                                                                                                              |

## Sprache / Übersetzungen

| PHP                       | Deno                       |
| ------------------------- | -------------------------- |
| `L('hallo', $name)`       | `` app.t`hallo ${name}` `` |
| `L()` (aktuelle Sprache)  | `ctx.lang`                 |
| `L::$all` (alle Sprachen) | `app.languages.all`        |

## db

| PHP                   | Deno                 |
| --------------------- | -------------------- |
| synchron (PDO)        | async/await (mysql2) |
| silent bei Fehlern    | throws               |
| inline Werte in Query | `?`-Platzhalter      |

## dbTable

| PHP                          | Deno                               |
| ---------------------------- | ---------------------------------- |
| synchrone Methoden           | alle async                         |
| `__get()` Magic              | explizite `field()`-Methode        |
| statisches Entry-Cache-Array | Context-basiert (`ctx.entryCache`) |

## dbEntry → DbRow

| PHP                   | Deno                                       |
| --------------------- | ------------------------------------------ |
| synchrone Methoden    | nur `$read`/`$save`/`$remove` sind async    |
| `__get()` / `__set()` | Accessoren pro Spalte auf der Klasse        |
| `$E->property`        | `row.property` (nach `table.get()` geladen) |

## HTML / Assets

Alles war statisch in PHP (`html::`) — in Deno instanz-basiert via `ctx.html`.

| PHP                          | Deno                                                  |
| ---------------------------- | ----------------------------------------------------- |
| `html::addJSFile($url)`      | `ctx.html.legacyScripts.add(url)`                     |
| `html::addCSSFile($url)`     | `ctx.html.styles.add(url)`                            |
| `html::addJSM($url)`         | `ctx.html.scripts.add(url)`                           |
| `html::$title = ...`         | `ctx.html.title = ...`                                |
| `html::$titlePrefix`         | `ctx.html.titlePrefix`                                |
| `html::$titleSuffix`         | `ctx.html.titleSuffix`                                |
| `html::$content .= ...`      | `ctx.html.content += ...`                             |
| `html::$head .= ...`         | `ctx.html.head += ...`                                |
| `html::$meta['description']` | `ctx.html.meta["description"]`                        |
| `html::getHeader()`          | `ctx.html.getHeader()`                                |
| `html::output()`             | `ctx.html.render()` (gibt String zurück, kein `echo`) |
| —                            | `ctx.html.prependContent(str)` (neu)                  |

## Pfade

| PHP                   | Deno                                   |
| --------------------- | -------------------------------------- |
| `appPATH` (Konstante) | `app.dir`                          |
| `appURL` (Konstante)  | `ctx.req.appUrl`                       |
| `sysURL` (Konstante)  | `ctx.req.moduleUrl`                    |
| —                     | `ctx.req.appPath` (Pfad nach appUrl)   |

## Hilfsfunktionen (divers.php)

| PHP               | Deno                               |
| ----------------- | ---------------------------------- |
| `hee($str)`       | `hee(str)` (htmlentities)          |
| `urlize($str)`    | `urlize(str)`                      |
| `Answer($data)`   | `AnswerException` werfen           |
| `template` Klasse | — (Template-Strings + HtmlBuilder) |

## CMS

| PHP                              | Deno                                                           |
| -------------------------------- | -------------------------------------------------------------- |
| `cms::$MainPage` (statisch)      | `app.cms.MainNode`                                             |
| `cms::$RequestedPage` (statisch) | `app.cms.RequestedNode`                                        |
| `cms::Page($id)`                 | `await app.cms.node(id)`                                       |
| `cms::PageByModule($module)`     | `await app.cms.nodeByModule(module)`                           |
| `cms::PagesByModule($module)`    | `await app.cms.nodesByModule(module)`                          |
| `cms::render()`                  | `render(ctx)` (separate `render.ts`)                           |
| `cms::filter($pages, $filter)`   | `await app.cms.filter(pages, filter)`                          |

### GET-Parameter

Neue Konvention: Modulname mit `_` statt `.` + camelCase-Name (siehe `qino/module/cms/README.md`).

| PHP                          | Deno                                       |
| ---------------------------- | ------------------------------------------ |
| `qgCms_editmode`             | `cms_editmode`                             |
| `qgCms_page_files_as_zip`    | `cms_nodeFilesZip`                         |
| `qgCmsNoFrontend`            | `cms_noFrontend`                           |
| `qgCmsVersSpace/Log/Page`    | `cms_versions_space` / `_log` / `_page`    |
| `changeLanguage`             | `lang`                                     |
| `cmspid`                     | `cmspid` (unverändert, eingefrorene Ausnahme) |

## Node / Page / Cont (gleiche Klasse)

Seiten und Inhalte (Conts) sind dieselbe Klasse. Die Deno-Klasse heisst jetzt
`Node`; `Page` existiert nur noch als deprecated Alias. In Modulen heisst die
Variable meist `Cont` oder `node`, ausserhalb meist `Node`/`Page`.

| PHP                                         | Deno                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------ |
| `$Page->Title()`                            | `await Page.title()`                                                           |
| `$Page->Title($lang, $value)`               | `await Page.title(lang, value)`                                                |
| `$Page->showTitle()`                        | `await Page.showTitle()`                                                       |
| `$Page->Text($name)`                        | `await Page.text(name)` (Objekt)                                               |
| `$Page->Text($name, $lang, $value)`         | `await Page.text(name, lang, value)`                                           |
| `$Page->Text('main')` (rendert)             | `await Page.showText('main')`                                                  |
| `$Page->Texts()`                            | `await Page.texts()`                                                           |
| `$Page->File('image')`                      | `await Page.file('image')` (DbFile)                                            |
| `$Page->Files()`                            | `await Page.files()`                                                           |
| `$Page->get($vars)`                         | `await Page.html(vars)`                                                        |
| `$Page->getPrepared($vars)`                 | `await Page.htmlPrepared(vars)`                                                |
| `$Page->getRaw($vars)`                      | `await Page.htmlRaw(vars)`                                                     |
| `$Page->getPart($part, $vars)`              | `await Page.htmlPart(part, vars)`                                              |
| `$Page->Children($filter)`                  | `await Page.children(filter)`                                                  |
| `$Page->Parent($level)`                     | `await Page.parent(level)`                                                     |
| `$Page->Path()`                             | `await Page.path()`                                                            |
| `$Page->Bough($filter)`                     | `await Page.bough(filter)`                                                     |
| `$Page->Cont($name)`                        | `await Page.cont(name)`                                                        |
| `$Page->Conts()`                            | `await Page.conts()`                                                           |
| `$Page->Page()`                             | `await Page.page()`                                                            |
| `$Page->access()`                           | `await Page.access()`                                                          |
| `$Page->SET['key']->v`                      | `await Page.settings.key` (item.js — siehe [Item.js-Pattern](#itemjs-pattern)) |
| `$Page->SET['key'] = x`                     | `Page.settings.key(x)`                                                         |
| `$Page->SET->has('key')`                    | `(await Page.settings).key` (autovivifiziert)                                  |
| `$Page->edit`                               | `Page.edit` (sync)                                                             |
| `$Page->vs['module']`                       | `Page.vs.module`                                                               |
| `$Page->app`                                | `Page.app` (Zugriff auf App)                                                   |
| `$Page->url()`                              | `await Page.url()`                                                             |
| `$Page->urlSeo($lang)`                      | `await Page.urlSeo(lang)`                                                      |
| `$Page->isOnline()` / `$Page->isReadable()` | `await Page.isOnline()` / `await Page.isReadable()`                            |
| `cms::$RenderPath[]` (statisch)             | `ctx.state.cmsRenderPath`                                                      |
| `qg::on('background', fn)`                  | `setTimeout(async () => { ... }, 0)`                                           |

### Node-Rendering / Assets

`Node.html()` rendert in mehreren Schritten:

- `htmlRaw(vars)` lädt das Modul über `app.need(Page.vs.module)` und ruft
  `module.cms.node.render(node, { ctx, vars })` auf.
- `htmlPrepared(vars)` injiziert CMS-Marker als **`qcms-*`-Attribute** in das
  erste HTML-Element (siehe [CMS-Marker-Attribute](#cms-marker-attribute)).
- `html(vars)` prüft Lesbarkeit, verhindert Render-Rekursion über
  `ctx.state.cmsRenderPath` und lädt Modul-Assets (`pub/main.js`,
  `pub/main.css`) automatisch.
- Freigegebene Parts werden über `cms.node.parts[part]` aufgerufen; `part`
  darf keine Slashes enthalten.

Wichtiges Convenience-Property:

- `node.modUrl` → `ctx.req.moduleUrl + node.vs.module + "/"`

### CMS-Marker-Attribute

Der Wrapper markierte gerenderte Knoten früher mit CSS-Klassen. Diese wurden
durch **HTML-Attribute** ersetzt — robuster (keine Klassen-Kollisionen, Werte
brauchen keine CSS-sichere Sanitisierung mehr, nur `hee()`-Escaping). Beispiel:
`<div qcms-id=170 qcms-mod="cont.text" qcms-name="main" qcms-edit qcms-drop qcms-offline>`.

| Alt (CSS-Klasse)         | Neu (Attribut)                       |
| ------------------------ | ------------------------------------ |
| `qgCmsCont` / `qgCmsPage`| entfällt — Knoten über `qcms-id`      |
| `-pid<id>`               | `qcms-id=<id>`                        |
| `-m-<cms-name-dashed>`   | `qcms-mod="<name>"` (ohne `cms.`, gepunktet, z.B. `cont.text`) |
| `-e`                     | `qcms-edit`                          |
| `qgCMS-dropTarget`       | `qcms-drop`                         |
| `qgCMS-offline`          | `qcms-offline`                     |
| `vcms-name`              | `qcms-name`                        |

Konsequenzen für Consumer (Scripts/Styles):

- Page vs. Cont wird nicht mehr per Klasse markiert, sondern aus `qcms-mod`
  abgeleitet: Seiten nutzen `layout.*`-Module → Selektor `[qcms-mod^="layout."]`;
  Content-Blöcke = alles andere mit `qcms-id`. JS braucht die Unterscheidung
  meist nicht (`closest('[qcms-id]')` liefert den innersten Knoten); CSS nutzt
  sie nur für Hover-Outlines (`[qcms-edit]:not([qcms-mod^="layout."])`).
- Client-Helper `cms.el` (in `cms/pub/js/cms.mjs`) liest jetzt Attribute:
  `nid(el)=closest('[qcms-id]').getAttribute('qcms-id')` (Node-Id, früher `pid`),
  `module(el)=getAttribute('qcms-mod')` (nackter Name, z.B. `backend.system.api`).
- Module rendern weder Modul-Marker (`-m-`-Klasse) noch eigene Node-Id
  (`data-pid="${node.id}"` o.ä.) mehr selbst aufs Root-Element — der Wrapper
  liefert `qcms-mod` + `qcms-id`. Modul-CSS zielt auf `[qcms-mod="<name>"]`,
  Modul-JS liest die Id via `cms.el.nid(el)`. (`data-pid` auf Sub-Elementen, die
  *andere* Nodes referenzieren, bleiben.)
- `cms.initCont("cms.X", fn)` wurde zu `cms.initNode("X", fn)` (Node-Terminologie,
  nackter Modulname passend zu `qcms-mod`).
- Modul-CSS, das früher auf die injizierte `-m-`-Klasse zielte, nutzt jetzt
  `[qcms-mod="<name>"]` (Module, die ihre `-m-`-Klasse selbst rendern, bleiben
  unverändert).

## CMS-Module (Cont/Layout) erstellen

Modulstruktur: `m/cms.cont.foo/index.php` → `m/cms.cont.foo/mod.ts`

PHP gibt HTML via `echo` aus, Deno via `return`.

```ts
export const name = "cms.cont.foo";

async function render(Cont: Page, { ctx }: any): Promise<string> {
  const text = await Cont.showText("main");
  return `<div${
    Cont.edit ? ` contenteditable cmstxt=${text.id}` : ""
  }>${text}</div>`;
}

export const cms = {
  node: {
    render,
  },
};
```

| PHP                                                  | Deno                                                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `html::addCSSFile(...)`                              | `ctx.html.styles.add(...)`                                                                  |
| `cms::$RenderPath`                                   | `app.cms.RenderPath`                                                                        |
| Layout: `include appPATH.'qg/'.$module.'/index.php'` | `await import(module.data+'index.ts')`                                                     |
| `exit` nach `header(...)`                            | `ctx.responseHeaders.set(...)`, `throw new OutputException(body)`                           |
| `parts/$part.php`                                    | expliziter Export unter `cms.node.parts`: `{ list }`                                        |

### Options

`options.php` wird als Funktion ueber `cms.node.options` exportiert:

```ts
async function options(Cont: Page, _vars: any): Promise<string> {
  const ctx = getCtx();
  return `...`;
}
```

### Page API

`page_api.php` wird als Funktion ueber `cms.node.pageApi` exportiert und via
`page::api`/API aufgerufen.

- `vars` enthält die übergebenen Parameter (z.B. `{do: 'rowRem', row: 2}`)

```ts
async function pageApi(
  Cont: Page,
  vars: any,
): Promise<void> {
  if (await Cont.access() < 2) return;
  // ...
}
```

## API

Neue zentrale API-Schicht: der **API-Baum**. Module definieren
verschachtelte API-Bäume, daraus werden REST-Routen, RPC-Proxies und LLM-Tools
abgeleitet.

| PHP / Legacy                                        | Deno                                                                              |
| --------------------------------------------------- | --------------------------------------------------------------------------------- |
| einzelne `serverInterface`-Methoden als primäre API | API-Baum in `api.ts`; `serverInterface` ist oft nur noch Shim                     |
| `page::api($pid, ...)`                              | `POST /api/cms/node/:node/api` bzw. `ctx.app.api.cms.node(pid).api.post(vars)`    |
| direkte Backend-Ajax-Handler                        | `ctx.app.api.<module>...` RPC-Proxy                                               |
| Modul-API via `module_api.php`                      | `moduleApi`- oder `api`-Export im `mod.ts`, aufgerufen über `ctx.app.api.core.module(module).api.post(vars)` |
| REST manuell schreiben                              | API-Baum wird vom Core automatisch unter `/api/...` bedient (`apiFetch`)          |
| AI-Tools separat definieren                         | `toTools(api)` erzeugt Tool-Definitionen aus denselben API-Routen                 |

API-Konventionen:

- `app.apiTree.<module> = api` registriert den Baum.
- `app.api` ist ein RPC-Proxy:
  `await app.api.cms.node(42).title.put({ value, lang })`.
- `get/delete` lesen `input` aus Query-Parametern, `post/put/patch` lesen
  `input` aus JSON-Body.
- `query` kann bei `post/put/patch` zusätzlich explizite Query-Parameter
  definieren.
- Pfadparameter (`:node`), Body- und Query-Felder landen gemeinsam in einem
  flachen `params`-Objekt. Namenskollisionen sind Setup-Fehler.
- Fehler werden als Exceptions geworfen: `AccessError` → 403, `NotFoundError` →
  404, `ValidationError` → 422, `ConflictError` → 409.
- `execute()` gibt Werte zurück; REST macht daraus JSON, `undefined` wird zu
  `204 No Content`.

### CMS-API-Routen (Auswahl)

| Zweck                         | RPC                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------- |
| Node lesen                    | `await app.api.cms.node(id).get()`                                            |
| Seitenbaum                    | `await app.api.cms.tree.get({ filter, level })`                               |
| Unterbaum                     | `await app.api.cms.node(id).tree.get({ filter, level })`                      |
| HTML rendern                  | `await app.api.cms.node(id).html.get({ vars })`                               |
| Part rendern                  | `await app.api.cms.node(id).html.part(part).get({ vars })`                    |
| Titel setzen                  | `await app.api.cms.node(id).title.put({ value, lang })`                       |
| Text setzen                   | `await app.api.cms.node(id).text(name).put({ value, lang })`                  |
| Kind erstellen                | `await app.api.cms.node(id).children.post({ title })`                         |
| Content-Block erstellen       | `await app.api.cms.node(id).contents.post({ module })`                        |
| Node verschieben              | `await app.api.cms.node(id).position.put({ target, before })`                 |
| Page-Settings lesen/schreiben | `await app.api.cms.node(id).settings.get({ path })` / `.put({ path, value })` |
| App-Settings lesen/schreiben  | `await app.api.core.settings.get({ path })` / `.put({ path, value })`         |
| User-/Session-Settings        | `await app.api.core["ctx-settings"].get({ path })` / `.put({ path, value })`  |

## AI

Das AI-Modul hängt ebenfalls an API und nutzt dieselbe API-Schicht für Tools.

| Konzept          | Deno                                                                                |
| ---------------- | ----------------------------------------------------------------------------------- |
| Chat Completions | `await app.api.ai["chat-completions"].post({ data })`                               |
| Bot-Chat-Session | `await app.api.ai["chat-session"].post({ data })`                                   |
| ServerInterface  | `serverInterface.ai.chatCompletions(data)` / `serverInterface.ai.chatSession(data)` |
| Bot-Registry     | `app.ai.registerBot(bot)`, `app.ai.getBot(id)`                                      |
| CMS-Bot-Tools    | aus `m/cms/api.ts` via `toTools(cmsApi, { filter })`                                |

`Bot`-Struktur:

```ts
interface Bot {
  id: string;
  provider?: string;
  model?: string;
  systemPrompt: string | ((ctx, clientContext) => string | Promise<string>);
  tools?: Tool[];
  chatSchema?: Record<string, unknown>;
}
```

`chatSession()` baut daraus Systemprompt, Messages, optionale Tools und optional
JSON-Output. Tool-Calls werden serverseitig ausgeführt und maximal 8 Iterationen
lang beantwortet.

## Item.js-Pattern

`app.settings`, `ctx.session` und ähnliche Objekte sind **item.js-Items** — ein
reaktiver, persistenter Baum.

**Wichtig: vorgeladen vs. nicht vorgeladen**

`ctx.session` ist beim Request bereits vollständig geladen — synchroner Zugriff
funktioniert:

```ts
ctx.session.key(); // liest direkt (sync)
ctx.session.key = x; // schreibt (fire & forget)
ctx.session.key(x); // schreibt (awaitable)
```

`Page.settings` und `app.settings` sind **nicht** vorgeladen — `item.key()`
liefert zunächst `undefined`. Erst nach `await item` sind die Werte verfügbar:

```ts
await Page.settings.key; // lädt + liest
Page.settings.key(x) // schreibt (awaitable)
(await Page.settings).key; // Existenz / Wert prüfen
```

| Operation             | session              | settings/SET         |
| --------------------- | -------------------- | -------------------- |
| Lesen                 | `item.key()`         | `await item.key`     |
| Schreiben (awaitable) | `item.key(x)`        | `item.key(x)`        |
| Existenz prüfen       | `item.key() != null` | `(await item).key`   |
| Dynamischer Schlüssel | `item[varKey]()`     | `await item[varKey]` |

Gilt für:

- `Page.settings` — CMS-Page-Einstellungen (war `$Page->SET`)
- `app.settings` — globale App-Einstellungen (war teil von `G()->SET`)
- `ctx.settings` — User (mit Fallback auf Session) Einstellungen (war teil von
  G()->SET)
- `ctx.session` — Session-Daten (war `$_SESSION`)

## Module-Lifecycle

| PHP                            | Deno                                                     |
| ------------------------------ | -------------------------------------------------------- |
| `qg.php` pro Modul             | `mod.ts` pro Modul, exportiert `name` und optional `init(app)` |
| `install.php` + `dbscheme.xml` | `install()`/`dbSchema` im `mod.ts` oder `dbschema.json`  |
| `qg::need($name)`              | `app.need(name)`                                         |

`dbscheme.xml` wird im Deno-CMS nicht mehr zur Laufzeit ausgewertet. Fuer weitere Ports aus `v9` bleibt `deno-cms/tools/xml-db-schema-to-json.ts` als Migrationswerkzeug erhalten; neue oder migrierte Module sollen danach `dbschema.json` oder einen `dbSchema`-Export im `mod.ts` verwenden.
