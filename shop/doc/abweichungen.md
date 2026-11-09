# Abweichungen qino ↔ PHP-Shop

Was der migrierte Shop anders macht als der PHP-Shop, und wo ich es anders lösen würde. Stand
09.11.2026. Grundlage: die Testmigrationen von Lascaux und Elixan, je in ihrem Projekt
(`projects/<site>/doc/qino-test.md`). Die Punkte stammen von Lascaux, wo nichts anderes steht.

**Abgleich der Preise** (`meta/migrate_shp3/tools/verify.ts`): Die letzten 60 Bestellungen je Site
wurden als Warenkorb nachgebaut. Alle Stückpreise (Lascaux 300, Elixan 227, mit Optionen),
Kleinmengenzuschläge und Versandkosten stimmen mit dem überein, was PHP verrechnet hat.

**Abgleich des Aussehens**: Shop-Seiten nebeneinander mit lascaux.ch fotografiert:
- Farblinien-Übersicht, Farblinie mit Farbfeldern, Farbe mit Kaufformular und Länderwahl
- Kategorie, Produkt, Kurs-Kategorie, Kurs
- Warenkorb (leer), Kasse (Adressen)

Sie decken sich, bis auf die Punkte unten. Gefüllter Warenkorb und Bestellung sind nur lokal
geprüft. Auf lascaux.ch lege ich nichts in den Warenkorb, das würde in die produktive Datenbank
schreiben.

## Sichtbar anders

1. ~~**Fehler im Warenkorb ohne „Lösung“-Knöpfe.**~~ Erledigt: `shop:line-check` kann `solutions`
   anbieten (`line.solutions()`, `line.solve()`, API `cart/lines/:id/solve`). Das Lager bietet
   „Stückzahl anpassen“ an, Lascaux' Kurse „Warteliste“ und „Personen reduzieren“.
2. **Versand- und Zahlungsart wird automatisch gewählt, wenn es nur eine gibt.** In PHP war das
   eine Einstellung (`auto_select_*`), bei Lascaux aus.
3. **Kundentyp privat/Firma** liegt im Browser (sessionStorage), nicht auf dem Server. Firmen
   ausserhalb CH/LI sehen kein Kaufformular, wie in PHP, aber nur im Browser durchgesetzt.

## Verhalten

4. **Rabatte addieren sich nicht mehr, der beste gewinnt.** In PHP wurden Aktion und Mengenrabatt
   multipliziert (20 % und 5 % = 24 %). In qino gilt der kleinste Faktor aus `shop_discount`. Damit
   kann sich auch der Händlerrabatt nicht zu einer Aktion addieren, die Falle aus der
   Briefing-Analyse. *Auswirkung heute:* keine, die einzige Aktion lief im Dezember 2024.
5. **Rabattpreise werden auf den Rundungsschritt der Währung gerundet** (CHF, EUR: 1 Rappen/Cent).
   PHP liess beim Mengenrabatt halbe Rappen stehen (20.045) und rundete Aktionen fest auf 0.05 CHF.
6. **Lager:** Eine Bestellung zieht auch beim Produkt ab, nicht nur bei der Variante. Bei Lascaux
   überschreibt der Blending-Import das ohnehin.
7. **Warenkorb zeigt immer die aktuellen Preise.** Den Fehler „Preise haben sich geändert“ gibt es
   nicht, Lascaux hatte ihn in PHP abgeschaltet.
8. **Produkte ohne Länder-Whitelist** (12) sind wie in PHP nirgends bestellbar. Das setzt das
   Projektmodul `cd` durch. Generisch verkauft `cms.shop.countries` sie überall.

## Adressen der Produkte

9. **Ein Produkt hat keine eigene Adresse mehr.** PHP hatte `/lascaux-artist/114-i1` (realurl).
    qino zeigt das Produkt auf seiner Kategorie mit `?shop_product=978`. Die 1230 alten Adressen
    leiten mit 301 dorthin weiter (`migrate_shp3`). Für Suchmaschinen ist das schlechter. Eigene
    Adressen für Inhalte bräuchten Unterstützung im cms-Kern, siehe `fehlend-in-qino.md` (2).

## Daten

10. **Varianten bleiben eine eigene Tabelle** (`shop_variant`, gleiche IDs), die Bezeichnung bleibt
    der Seitentext `variant_<id>`. Eigene Unter-Seiten habe ich geprüft und verworfen: 1381
    Varianten ohne eigene Texte, Bilder oder Rechte würden den Seitenbaum aufblähen. Neu ist die
    Variante eine Spalte der Position (`variant_id`) statt `config.shp3_variant`.
    *Würde ich so lassen.*
11. **Optionen** (`shp3_product_opt*`) sind jetzt das Modul `cms.shop.options`, gebraucht von Elixan
    (86 Produkte, „Mit Schachtel“). In der Bestellung stehen sie als `data.options` statt
    `config.shp3_opt`. Im Formular sind sie `<label>` statt Tabellenzeilen.
12. **Alte Bestellungen werden brutto gespeichert** (`tax_included`). PHP speicherte Netto mit
    Bruchteilen von Rappen. Zurückgerechnet stimmt es exakt. 49 von 1948 Bestellungen ergeben aus
    den Positionen ein paar Rappen anders (fin rundet jede Position). Gespeichert bleibt der
    verrechnete Betrag.
13. **Offene Warenkörbe** werden nicht migriert, sie hingen an den alten Sessions.
14. **Zahlungen alter Bestellungen** werden nicht als fin.payment angelegt, nur der Status (`paid`).
    Die alte Rechnungsnummer (accounting1) steht in `shop_order.data`.
15. **Positionsbeschreibungen sind Klartext** (eine Zeile pro Teil) statt HTML-Divs.
16. **Adressen** sind JSON in fin-Form (schema.org-Namen) statt 20 `bill_*`/`ship_*`-Spalten.
17. **Beträge in Minor Units** (Rappen), wie fin.
18. **Die Fracht-Methode heisst `freight`** statt `freight.cd`.
19. **Methodennamen** („Priority“, „Twint“) sind die Einstellung `cms.shop.labels` je Sprache statt
    Texte der Startseite (`shp3_shipping_*`). Übernommen.

## Kurse

20. **Kurse sind portiert:** Ansicht, freie Plätze, Firmenbesichtigung, Teilnehmer bei jeder
    Bestellung (`event2_participant`), Bestätigungsmail mit Kalendereintrag, Warteliste kostenlos.
    Die Tabellen `event2*` bleiben die von PHP. Ein Veranstaltungsmodul gibt es in qino nicht.
21. **Die Warteliste** kommt wie in PHP nur über den Warenkorb-Fehler zustande, über dessen Knopf.
    Anders als PHP nimmt qino eine Warteliste nicht von selbst zurück, wenn wieder Platz frei wird.

## Nicht portiert

22. **Mailtext der Bestellbestätigung:** generisch statt `on-order-mail.php`. CSV und
    Rechnungs-PDF hängen wie bisher an der internen Kopie.
23. **Rechnungs-PDF** kommt von fin.invoice: anderes Layout, ein Absender für alle (PHP: bei EUR
    die GmbH), siehe `fehlend-in-qino.md`.
24. **Das Akkordeon-Script von `category.cd`** ist toter Code: Das aktuelle PHP-Template enthält
    kein Akkordeon mehr.
25. **Der Feiertagshinweis** (`cd_feiertage()`) war in PHP abgeschaltet und ist leer portiert.

## Backend

26. **Vorhanden:** Shop-Übersicht, Bestellungen, Produkte (Preis, Masse, Varianten, Lager, eigene
    MwSt, Preise je Währung, Länder, Optionen, `prop_*`-Merkmale), Rabatte, Versand, Währungen und
    Länder. Bei Lascaux dazu Blending und Bestell-Export im Projekt.
27. **Anders aufgebaut:** Die Seiten sind einfache Tabellen, eine Zeile speichert beim Ändern
    (`renderRows`). Länder gibt man als Code ein, es gibt keine Massenbearbeitung. Ein Produkt zeigt
    seine eigenen Felder untereinander (`single`), was leer bleibt, bekommt beim Anlegen den Standardwert. Die alten Backend-Seiten ersetzt `migrate_shp3`, statt sie doppelt zu führen.
    Datumswerte gelten als Tag in UTC.

## Elixan

28. **Zahlung auf Rechnung** heisst jetzt `qrbill` (QR-Einzahlungsschein von fin) statt `invoice`.
    Eine in `accounting1` bezahlte Rechnung macht die Bestellung `paid`, sonst blieben 48 alte
    Bestellungen offen. Die Rechnungen selbst sind nicht migriert (`fehlend-in-qino.md`).
29. **Saferpay-Zugang und IBAN** kommen mit, `live` bleibt aus: Eine Kopie einer Site nimmt kein echtes
    Geld, bis es jemand einschaltet.
30. **Warenkorb:** das Standard-Template von `cms.cont.shop.cart` statt des Site-Templates. Neu führt die
    Einstellung `next` zur Kasse, das Template hatte den Link fest eingebaut. Es fehlen das Bild und
    die Spalte „Entfernen“ als Text (Knopf statt Link).
31. **Der Hinweis auf Betriebsferien** im Produkt ist weggelassen, er lief bis 05.01.2026.
32. **Adressen:** `usr.bill_*` wird zum Profil von `user.profile`, ein neuer Warenkorb eines
    angemeldeten Kunden beginnt damit. Die Lieferadresse des Kunden (`usr.ship_*`) ist nicht übernommen.
33. **Aussehen:** Produkt, Kategorie, Kasse nebeneinander mit elixan.ch verglichen. Fast gleich; die
    Kategorie-Spalten sind etwas schmaler, das Akkordeon „Wichtige Hinweise“ hat keinen Pfeil.

## Im Test bewusst weggelassen

- SQLite statt MariaDB: `meta/migrate_shp3/tools/dump2sqlite.py` ersetzt Import plus `prepare-db.sh`.
- Nur der Shop-Teilbaum ist portiert (Shop, Warenkorb, Layout). Seiten ausserhalb mit Lascaux-Modulen
  (`cms.cont.cd.*`: Slider, Videos …) zeigen dort eine Lücke.

## Wie portiert

- **Layout** (`module/cms.layout.lascaux`): Markup und CSS wie in PHP. Inline-Styles in
  `pub/layout.css`, PHP-Klassen der CSS auf qino-Attribute umgeschrieben (wie `migrateCss`).
- **Site-Templates** der PHP-Module (Produkt, Warenkorb) sind eigene Projektmodule
  (`cms.cont.shop.product.cd`, `cms.cont.shop.cart.cd`). Das Projekt stellt die Seiten darauf um.
  Kategorien behalten ihre Modulnamen.
- **Site-CSS in `data/`** zieht mit den umbenannten Shop-Modulen um (`migrate_shp3`).
- **PHP-Files** im Shop (AGB-Zustimmung, Fuss, Feiertage) liegen in `site-templates/cms.cont.ts/`.
