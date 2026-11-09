# Fehlend in qino

Lücken in **anderen** Modulen, gefunden beim Bau von `cms.shop` und den Migrationen von Lascaux und
Elixan. Nichts davon ist angefasst, es sind Vorschläge. Stand 09.11.2026.

## Sichtbar bei Lascaux

1. ~~**cms.cont.nav liest migrierte Einstellungen nicht.**~~ Erledigt: `migrate_from_php` wandelt
   Seiten-Einstellungen nach dem Schema des Moduls um (`coerceSettings.ts`, PHP speicherte `"10"`).
2. **Inhalte mit eigener Adresse: gebaut, ohne Backend.** Ein Inhalt ist ein berechneter Anker `#cmspidN`
   ohne Zeile in `page_url`, ausser jemand gibt ihm einen Namen (`#kontakt`). Ein Modul sagt `childUrls`,
   dann haben seine direkten Kinder dort eine echte Adresse; sie folgt Titel und Seite. Dort
   rendert die Seite normal, die Kategorie zeigt nur das angefragte Kind. Produkte auf eigener
   Seite und One-Pager bleiben wie sie sind. Offen: ein Backend-Panel für Adresse und SEO-Texte von
   Inhalten; nach einer Umbenennung gibt es keine automatische Weiterleitung.
3. **cms `Node.set({ settings | module })` lässt `node.settings` veraltet.** Das
   Einstellungs-Objekt wird beim Laden gebaut. Wer in `install()` per `set()` schreibt, sieht im
   selben Prozess bis zum Neustart die alten Werte (bzw. das alte Schema). Deshalb renderten die
   Checkout-Bausteine nach der Migration leer. `migrate_shp3` schreibt über
   `node.settings[$item].set()`. Vorschlag: `set()` baut das Objekt neu.
4. **`renamedModules.ts`: `cms.cont.lang.choose2` fehlt.** Es ist `cms.cont.lang.choose`, nur die
   Einstellung heisst `to Page` statt `toPage`. Das Projekt biegt es selbst um.
5. **`cms.cont.breadcrumb2`** gibt es in qino nicht. Für Lascaux im Projekt portiert, ein Kandidat
   für `cms-legacy`.

## Für Lascaux nötig, ausserhalb des Shops

6. **fin.payment.saferpay: ein Terminal pro Währung.** Lascaux hat für EUR ein eigenes Terminal.
   Der Provider kennt nur eines. Vorschlag: `terminals` je Währung, das jetzige als Standard.
7. **fin.invoice: mehrere Absender.** AG (Schweiz) und GmbH (EU) stellen je eigene Rechnungen. fin
   nimmt den Absender aus `identity`, also gibt es nur einen. Dazu Reverse Charge für
   EU-Händler: `taxCategory: "AE"` kann fin, wer es bekommt, entscheidet der Shop.
8. **Veranstaltungen:** Ein qino-Modul für `event2` fehlt. Lascaux' Kurse laufen im Projekt
   direkt auf den PHP-Tabellen.
9. **Backend-Tabelleneditor.** Der Shop hat jetzt einen eigenen: `renderRows`/`saveRows` in
   `cms.backend.shop`. Er ist nicht shop-spezifisch und könnte nach `cms.backend` wandern, sobald ein
   zweites Modul ihn braucht. Offen dort: Länder-Auswahl und Massenbearbeitung.

## Werkzeuge und Kern

10. **`csv()` kennt nur das Komma.** Excel in der Schweiz und PHPs `fputcsv` für Lascaux nehmen
    Semikolon. Der Export schreibt seine Zeilen deshalb selbst. Vorschlag: `csv(rows, { separator })`.
11. **`html\`\`` und leere Attributwerte.** `value=${v}` ohne Anführungszeichen wird mit `v = ""`
    zu `value= type=text`, und der Browser liest „type=text“ als Wert. Das hatte ich in allen
    Shop-Templates. Vorschlag: `html` setzt interpolierte Attributwerte selbst in Anführungszeichen.
12. **`cms-image` und `cms-image2` geben die Grösse verschieden vor.** PHP: `width:100%;
    max-width:<px>`. qino: `width:<px>; max-width:100%`. In Flex-Spalten zählt die feste Breite als
    Mindestbreite, Spalten werden breiter. Für Lascaux in der Produkt-CSS angeglichen. Ein
    Kandidat für die Migration von Site-CSS.
13. ~~**module_boundaries.test.ts und `schemaColumns.ts` kennen den Store `shop/` nicht.**~~ Erledigt.
14. **migrate_from_php ohne MariaDB:** `migrate_shp3/tools/dump2sqlite.py` macht aus dem Dump SQLite,
    und die ganze CMS-Migration läuft darauf. Es gehörte eigentlich zu `migrate_from_php/tools/`.
15. ~~**`renamedModules.ts` benennt `cart3` → `cart1` um.**~~ Erledigt, `migrate_shp3` nimmt beide.
16. **migrate_from_php/accounting** (accounting1 → fin) exportiert nur aus MySQL.
17. **cms `Node.text(name, lang)` legt einen fehlenden Text beim Lesen an.** cms.shop liest über
    `node.texts()`. Vorschlag: ein lesender Zugriff, der nichts anlegt.
18. ~~**shp3 als Store ablösen.**~~ Erledigt: `starter.shop` und `cms.cont.shop.cart.small` liegen in `shop/`.
19. **shwups-Modul:** `init()` fragt `oauth_provider` ab und fängt den Fehler bewusst ab. Der
    DB-Treiber protokolliert ihn trotzdem bei jedem Start („no such table“).
20. **Rohe Schreibzugriffe und die Identity-Map.** Ein rohes `UPDATE` per `db.exec` ohne `WHERE id` (der
    Blending-Lagerimport setzt alle Bestände) erreicht die gehaltenen Zeilen-Objekte nicht, und
    `DbTable` kann nur einzelne IDs invalidieren. Der Import liest deshalb danach alle IDs und
    invalidiert sie einzeln. Vorschlag: `table.invalidate()` ohne ID verwirft alle gehaltenen Zeilen.

## Von Elixan

21. **`renamedModules.ts`: `cms.cont.my.change_pw1` fehlt.** Das Modul heisst jetzt
    `cms.cont.my.password`, die Seite bleibt sonst ohne Modul.
22. ~~**Bestellt, aber Zahlung startet nicht.**~~ Erledigt: Die API meldet `paymentFailed`, die Kasse fragt nach,
    `order/:id/pay` und „Jetzt bezahlen“ in `cms.cont.shop.my.orders` versuchen es erneut.
23. **migrate_from_php/accounting (16) bei Elixan:** 305 alte Rechnungen liegen weiter nur in
    `accounting1_*`. Die Bestellung kennt ihre Nummer (`data.accounting1`).
24. **`cms.cont.my.*` brauchen `cms.mjs`.** Sie rufen `cms.initNode`, laden es aber nicht. Eine Site-Layout
    ohne `cms.mjs` wirft auf der Kontoseite `cms is not defined`, die Bausteine bleiben tot. Elixans Layout
    lädt es deshalb selbst. Vorschlag: Die Bausteine nennen `cms.mjs` in ihren eigenen `js`.
25. **`usr.ship_*`:** `user.profile` kennt nur eine Adresse. Für eine gespeicherte Lieferadresse
    bräuchte es eine zweite, oder Bestellungen merken sich die letzte.

## Von drucken.ch

25. **`migrateText` setzte `text.log_id_ch` voraus,** ältere Sites haben die Spalte nicht. Behoben. Weitere Annahmen dieser Art können in `migrate_from_php` noch stecken; geprüft ist nur, was dieser Test berührt.
26. **`fin.payment.datatrans`** fehlt. Nötig, sobald eine Datatrans-Site wirklich migriert wird.
