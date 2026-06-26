# Qino Review 2 — neue Funde

Zweiter, unabhaengiger Durchgang am 2026-06-25. **Ergaenzt** [REVIEW.md](REVIEW.md), wiederholt dessen Punkte nicht (CMS-XSS, CSP-Default, DbEntry-Autosave, `initLog`-Dedup-Race, Static-vor-`#initRequest`, Range-Buffering, AI-Rate-Limit usw. bleiben gueltig). Hier nur Funde, die dort **nicht** stehen oder deutlich konkreter sind.

Status:

- **bug**: konkreter Defekt mit reproduzierbarer Auswirkung
- **offen**: gueltiger Handlungsbedarf
- **by design**: bewusst, eher dokumentieren/haerten

---

## 1. Prioritaet

1. **`__Host-`-Cookie mit `Path=${appURL}`** bricht jede Installation mit `basePath` ueber HTTPS — Sessions/Clients funktionieren still nicht mehr.
2. **`auth-before`-Event traegt das Klartext-Passwort** zu allen Listenern.
3. **`select(string)` / `deleteWhere(string)` = roher WHERE** als SQL-Injection-Einfallstor neben dem sicheren Tagged-Template-Pfad.
4. **`App.fire` / `Db.fire`: ein werfender Listener killt die ganze Hook-Kette** (render/respond/action).

---

## 2. Security

| Status | Finding | Position |
|--------|---------|----------|
| bug | **`__Host-`-Cookie verletzt die Praefix-Regel.** `__Host-` verlangt zwingend `Path=/` (und kein `Domain`). Gesetzt wird aber `Path=${ctx.appURL}`. Bei `basePath=""` ist das `/` (ok), bei jeder Mount-Installation (`appURL="/cms/"`) ueber HTTPS lehnt der Browser Session- **und** Client-Cookie ab → Login/Session/Client brechen lautlos. Fix: fuer `__Host-` immer `Path=/`, oder ohne `__Host-`-Praefix arbeiten wenn `basePath` gesetzt ist. | [SessionManager.ts](module/core/lib/SessionManager.ts#L73), [init.ts](module/core/lib/init.ts#L27) |
| offen | **`auth-before` leakt Klartext-Passwort.** `await ctx.app.fire("auth-before", { email, pw })` reicht das eingegebene Passwort an jeden Listener (Logging, Security-Modul, …). Eine versehentliche `console.log(data)`/Audit-Zeile schreibt es ins Log. Nur `email` (und ggf. ein Resultat-Flag) uebergeben. | [auth.ts](module/core/lib/auth.ts#L32) |
| offen | **CSRF-Token-Vergleich ist nicht laufzeitkonstant.** `ctx.post["token"] !== ctx.token` ist ein normaler String-Compare. Geringes Risiko, aber `crypto.timingSafeEqual` o. ae. ist hier billig. | [auth.ts](module/core/lib/auth.ts#L12), [auth.ts](module/core/lib/auth.ts#L18) |
| offen | **Roher WHERE-String als SQL-Senke.** `select(v)` macht bei `string` ein `sql.raw(v)`; `deleteWhere(string)` und `#deleteWhere` reichen direkt durch. Der Tagged-Template-Pfad ist sicher, dieser Overload ist die Injection-Luecke. Aufrufer auditieren, String-Overload deprecaten/entfernen, nur `Sql` zulassen. | [DbTable.ts](module/core/lib/DbTable.ts#L122), [DbTable.ts](module/core/lib/DbTable.ts#L124), [DbTable.ts](module/core/lib/DbTable.ts#L251) |
| by design | **`save_login` umgeht das Passwort nur bei nicht-rehash-beduerftigem Hash.** Logik ist korrekt, aber subtil: ein `$2y$`-Hash erzwingt erst einen echten Passwort-Login (rehash), danach greift Auto-Login. In Doku festhalten. | [auth.ts](module/core/lib/auth.ts#L36) |

---

## 3. Korrektheit / Concurrency

| Status | Finding | Position |
|--------|---------|----------|
| bug | **`logout()` persistiert `usr_id=0` nicht zuverlaessig.** `ctx.client.set("usr_id", 0)` wird **nicht** awaited; `DbEntry.set` plant nur einen 50 ms-Autosave. Bei kurzlebigem Prozess/Scope-Ende kann der Reset verloren gehen. `login()` macht es richtig (`await ctx.client.set(...)`). Inkonsistent → in `logout` awaiten. | [auth.ts](module/core/lib/auth.ts#L67), [auth.ts](module/core/lib/auth.ts#L59) |
| offen | **`fire()` bricht bei erstem Throw ab.** Sequentielle Schleife ohne try/catch: ein werfender `render`/`respond`/`action`-Listener verschluckt alle nachfolgenden Hooks und propagiert als 500. Ein Modul kann so die ganze Pipeline anderer Module killen. Pro-Listener isolieren (try/catch + Sammel-Error) oder bewusst dokumentieren. Gilt fuer App **und** Db. | [App.ts](module/core/lib/App.ts#L89), [Db.ts](module/core/lib/Db.ts#L126) |
| offen | **`initLog`-Anreicherung haengt an `setTimeout(100)`.** Der 100 ms-Timer ist ein Rateversuch, dass der Haupt-Insert durch ist — danach wird ohnehin `await ctx.logId`. Der Timer ist unnoetig und fragil: besser direkt `ctx.logId.then(...)` verketten statt fixe Verzoegerung. | [init.ts](module/core/lib/init.ts#L65) |
| offen | **Unverfolgte Hintergrund-Timer = Datenverlust beim Shutdown.** `DbEntry`-Autosave (50 ms), `Session.touch` (50 ms) und `initLog` (100 ms) laufen als losgeloeste `setTimeout` nach der Response. Es gibt keinen Flush/Drain beim Prozess-Stop; in-flight Writes gehen verloren. Zentrale Registrierung + `drain()` beim Shutdown. | [DbEntry.ts](module/core/lib/DbEntry.ts#L98), [SessionManager.ts](module/core/lib/SessionManager.ts#L36) |
| offen | **`entryId` joint Composite-Keys mit `-:-`.** Enthaelt ein Schluesselwert die Literalfolge `-:-`, kollidiert/zersplittert die EID (`entryId2Array` splittet wieder darauf). Bei nicht-numerischen Composite-PKs (Strings) real moeglich. Trennzeichen escapen oder strukturierte EID. | [DbTable.ts](module/core/lib/DbTable.ts#L88), [DbTable.ts](module/core/lib/DbTable.ts#L98) |

---

## 4. Performance / Ops

| Status | Finding | Position |
|--------|---------|----------|
| offen | **`initLog` macht bis zu 8 sequentielle Roundtrips pro Request** (4× SELECT-dedup + 4× INSERT fuer url/referer/ip/ua). Auch im Hintergrund ist das pro Besucher DB-Last und verschaerft die in REVIEW.md genannte Dedup-Race. Batchen / `INSERT … ON CONFLICT … RETURNING id` / In-Memory-Cache fuer ip/ua. | [init.ts](module/core/lib/init.ts#L65) |
| offen | **`select()` ohne LIMIT materialisiert ganze Tabellen** in ein Objekt (`entryId`→row). Mehrere Backend-Listen/Copy-Pfade gehen darueber; bei grossen Tabellen RAM-/Latenz-Problem. Pagination/Streaming-Variante anbieten. | [DbTable.ts](module/core/lib/DbTable.ts#L122), [DbTable.ts](module/core/lib/DbTable.ts#L289) |

---

## 5. Architektur / Aufraeumen

| Status | Finding | Position |
|--------|---------|----------|
| offen | **`on`/`fire`/`#events` sind in App und Db Copy-Paste.** Identischer Mini-EventEmitter zweimal. In einen winzigen `Emitter`-Helfer ziehen (deckt sich mit dem „doppelter Bus"-Punkt in REVIEW.md, hier konkret: gemeinsame Implementierung statt nur gemeinsamer Typ). | [App.ts](module/core/lib/App.ts#L85), [Db.ts](module/core/lib/Db.ts#L123) |
| offen | **`HtmlBuilder.render()` schliesst `<body>`/`<html>` nicht.** HTML5 erlaubt optionale End-Tags, aber nichts kann mehr nach `body` haengen und Tooling/Diffing wird unnoetig fragil. Abschluss-Tags ergaenzen. | [HtmlBuilder.ts](module/core/lib/HtmlBuilder.ts#L56) |
| offen | **`db.all/row/col/one/indexCol` casten ueber `(this.query as any)`.** Der Overload-Trick wiederholt sich fuenfmal mit `any`; eine private `#query(a, rest)` als gemeinsame Basis entfernt die Casts. | [Db.ts](module/core/lib/Db.ts#L68) |
| offen | **Context-Init ist halb hier, halb im LangManager** — der Inline-Kommentar in `initSettings` benennt die Inkonsistenz selbst (`lang` via `LangManager.initCtx`, `settings` hier). Reihenfolge/Ownership der Per-Request-Initialisierung an einer Stelle buendeln (passt zur `runScope`-Idee aus REVIEW.md). | [RequestContext.ts](module/core/lib/RequestContext.ts#L64), [App.ts](module/core/lib/App.ts#L144) |
| offen | **`entry(undefined)` wirft statt zu generieren** — der eigentliche „neuer Entry ohne ID"-Pfad ist auskommentiert. Laut AGENTS.md nicht loeschen; aber als bewusste Luecke markieren, sonst stolpert man bei `entry()`-Aufrufen ohne ID. | [DbTable.ts](module/core/lib/DbTable.ts#L267) |

---

## 6. Schnell-Wins

- `logout()`: das fehlende `await` ergaenzen — Einzeiler, klarer Korrektheitsgewinn. [auth.ts](module/core/lib/auth.ts#L67)
- `auth-before`: `pw` aus den Event-Daten nehmen. [auth.ts](module/core/lib/auth.ts#L32)
- `__Host-`-Cookie: `Path=/` erzwingen (oder Praefix bei `basePath` weglassen). [SessionManager.ts](module/core/lib/SessionManager.ts#L73), [init.ts](module/core/lib/init.ts#L27)
- `initLog`: `setTimeout(100)` durch `ctx.logId.then(...)` ersetzen. [init.ts](module/core/lib/init.ts#L65)
