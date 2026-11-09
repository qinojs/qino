# Backend: Ideen aus dem PHP-Shop

Was die Backend-Seiten von shp3 konnten, verglichen mit `cms.backend.shop*`. Quelle:
`v9/m/cms.backend.shp3*`. Stand 09.11.2026. Das ist eine Sammlung, keine Entscheidung.

## Übernommen
- **Einstellungen:** Land des Shops, MWST in den Preisen, Währungen (Hauptwährung zuerst, ihr Faktor gesperrt, nicht entfernbar), Länder (belieferte zuerst, Tabelle scrollt). Neu dazu: angebotene Methoden und ihre Texte je Sprache.
- **Übersicht:** neueste Bestellungen, meist gekauft, zuletzt erfasste Produkte.
- **Produkte:** Bild und Kategorie in der Liste, Filter nach Kategorie, Preis und Lager direkt ändern, neues Produkt in einer Kategorie anlegen, offline Produkte markiert.
- **Vermietung:** Mietintervall und Preisregeln am Produkt (`cms.shop.rent`).
- **Bestellungen:** Zeitraum, offene Warenkörbe.

## Noch offen, nach Nutzen
1. **Produkte sortieren** (`products`): Spalten sortierbar, wählbare Spalten, Reihenfolge per Ziehen. Anlegen geht bisher nur, wo Produkte Inhalte einer Kategorie sind, nicht bei eigenen Produktseiten.
2. **Länder-Whitelist als Matrix** (`country_whitelist`): Produkte gegen Länder als Kreuztabelle, „alle Produkte einer Kategorie“ auf einmal setzen. Heute ein Land pro Zeile und Produkt.
3. **Versand je Land** (`shipping_by_weight_and_country`): Länderliste, darunter die Tarife dieses Landes; heute eine lange Gesamttabelle.
4. **Aktionspreise** (`special_offer`): aktueller, regulärer und Aktionspreis nebeneinander in einer Liste.
5. **Lieferschein als PDF** (`orders1/custom/delivery-note.pdf.php`).
6. **Gutscheine:** Modul und Seite gibt es (`cms.shop.coupon`). Offen: Mindestwarenwert, „inkl. Aktionen“, Einlösen per Link.
7. **Zahlart je Land** (`payment_by_country`): Länder gegen Zahlarten als Kreuztabelle. Fehlt im Shop, heute nur über `shop:payments`.
8. **Produkt-Merkmale verwalten** (`props`): Felder anlegen (Text, Zahl, Checkbox), mit Titel, Anzahl und vorkommenden Werten. Heute deklariert die Site `prop_*` im eigenen Modul, im Backend nur als Checkbox.
9. **Kategorien** (`categories`): Liste mit Anzahl Produkte je Kategorie.
10. **Google-Merchant-Feed** (`google_feed`): eigenes Modul.
