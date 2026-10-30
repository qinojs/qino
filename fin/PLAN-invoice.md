# PLAN Rechnungen, offene Posten, Mahnwesen

Umgesetzt (2026-10): Dokument = offener Posten, Zahlungen verteilt über `invoice_payment`
(OR 85–87), Typen `invoice`/`credit_note`/`proforma`/`reminder`, `preceding`, Storno per Gutschrift,
`writeOff` (`uncollectible`), eingefrorenes PDF, Steuerkategorie pro Position, Sammelmahnung mit
Gebühr und Verzugszins, MWST-Ziffern nach Kategorie. Beschrieben in den READMEs:
[fin.invoice](fin.invoice/README.md), [fin.invoice.reminder](fin.invoice.reminder/README.md),
[fin.accounting](fin.accounting/README.md), [fin.accounting.ch](fin.accounting.ch/README.md).
Anforderungen: [PLAN-fin.md](PLAN-fin.md#anforderungen), Rechtliches: [LAW-CH.md](LAW-CH.md).

## Von einem Treuhänder bestätigen lassen

- **Mahngebühr bei mehreren Steuersätzen**: anteilig nach offenem Betrag pro Satz und Kategorie
  verteilt (MWST-Info 04, 3.8.2.3 sagt nur: Teil des Entgelts der gemahnten Leistung).
- **Zuordnung Kategorie → Ziffer**: `G`/`K`/`Z` → 220, `AE` → 221, `E` → 230, `O` → kein Umsatz.
  Besonders: Leistungen ins Ausland als `AE`.
- **Verzugszins ab Fälligkeit**: setzt voraus, dass das Fälligkeitsdatum ein Verfalltag ist
  (OR 102 II); sonst erst ab der ersten Mahnung.
- **Ausbuchen**: MWST-Korrektur sofort beim Ausbuchen — gilt nur bei endgültigem Verlust
  (Verlustschein), nicht für eine blosse Wertberichtigung.

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
