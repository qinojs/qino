# PLAN Rechnungen, offene Posten, Mahnwesen

Umgesetzt (2026-10): Dokument = offener Posten, Zahlungen und Gutschriften begleichen über
`invoice_settlement` (OR 85–87), Typen `invoice`/`credit_note`/`proforma`/`reminder`, `preceding`, Storno per Gutschrift,
`writeOff` (`uncollectible`), eingefrorenes PDF, Steuerkategorie pro Position, Sammelmahnung mit
Gebühr und Verzugszins, MWST-Ziffern nach Kategorie. Beschrieben in den READMEs:
[fin.invoice](fin.invoice/README.md), [fin.invoice.reminder](fin.invoice.reminder/README.md),
[fin.accounting](fin.accounting/README.md), [fin.accounting.ch](fin.accounting.ch/README.md).
Anforderungen: [PLAN-fin.md](PLAN-fin.md#anforderungen), Rechtliches: [LAW-CH.md](LAW-CH.md).

## Recherchiert (2026-10), ohne Treuhänder

Quellen und Wortlaut in [LAW-CH.md](LAW-CH.md).

- **Mahngebühr bei mehreren Steuersätzen**: anteilig nach offenem Betrag pro Satz und Kategorie.
  Die ESTV sagt nur „gehören zum Entgelt der erbrachten Leistung“ (MWST-Info 04, 3.8.2.3); bei
  mehreren Leistungen ist die anteilige Verteilung die Umsetzung davon. Bleibt.
- **Zuordnung Kategorie → Ziffer**: `G`/`K`/`Z` → 220, `AE` → 221, `E` → 230, `O` → kein Umsatz —
  deckt sich mit Formular und Praxis. Ausgenommene Leistungen mit Ort im Ausland ohne Option
  (Versicherung, Finanz) gehören in 230, nicht 221: dort `E` wählen.
- **Verzugszins erst ab der Mahnung**: Ein Fälligkeitsdatum oder „zahlbar innert 30 Tagen“ auf
  der Rechnung ist nach h.M. kein verabredeter Verfalltag (OR 102 II). Umgesetzt: Zins ab der
  ersten Mahnung, die Zahlungserinnerung trägt keinen.
- **Ausbuchen nur beim endgültigen Verlust** (Verlustschein, Konkurs): Erst dann wird die MWST
  korrigiert, in der laufenden Periode (MWSTG 41 I), Ziffer 235 — so weist es `vatReturn` jetzt
  aus. Eine Wertberichtigung (Delkredere) korrigiert keine MWST: von Hand buchen, nicht
  `writeOff`. Zahlt der Schuldner danach doch, ist die Steuer darauf wieder geschuldet:
  umgesetzt, der Verlust wird auf den Rest neu gebucht.

## Später

- Vereinnahmte MWST-Methode (MWSTG 39 II); Bezugsteuer (382/383) auf Eingangsrechnungen mit `AE`.
- Fremdwährung buchen (Kurs der ESTV, MWSTV 45); heute nur als offener Punkt beim Jahresabschluss
  gemeldet.
- Skonto, Bargeldrundung, Anzahlungsrechnungen (Teilrechnungen).
- Mahnsperre pro Debitor; Inkasso; Zugriff weiterer Benutzer auf die Dokumente eines Debitors.
- Zahlungen von Hand auf mehrere Dokumente verteilen (Bankimport, Sammelzahlung) — `allocate`
  verteilt heute nach `ref`.
- E-Rechnung (EN 16931): Typen, `preceding` und Kategorien sind schon danach benannt.
- PHP-Import: Die Mahnstufe aus PHP hat keine eigene Mahnung; solche Rechnungen werden gesperrt
  (`remind` false) statt wieder bei der Zahlungserinnerung zu beginnen.
