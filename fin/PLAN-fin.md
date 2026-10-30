# PLAN fin

Geld in qino: bezahlt werden, bezahlen, Forderungen, Bankabgleich, Buchhaltung. Eine Grundlage zur
Diskussion. Die Module liegen in einem eigenen Store, diesem Ordner; das Modul `fin` ist ihre Basis
(die Texte, die Zahlende lesen, Postadresse und IBAN der Benutzer).

## Anforderungen

- **Alle bedienen, skalieren.** fin soll vom Einzelunternehmen bis zum grossen Betrieb taugen.
  Ausbaubarkeit und grosse Nutzer gehen vor Einfachheit — einfach ist aber erwünscht und oft
  gerade das, was gut und skalierbar ist.
- **Modular.** Jede Schicht ist für sich nutzbar: Rechnungen ohne Buchhaltung, auch ohne Benutzer
  (`usr_id`) als Debitor.
- **Wie professionelle Software.** Lösungen orientieren sich daran, wie es etablierte Systeme
  machen (SAP, Business Central, Abacus, Odoo, bexio …), statt eigene Wege zu erfinden.
- **Rechtlich korrekt, recherchiert statt vermutet.** Rechtliche und steuerliche Details werden
  recherchiert und mit Quellen notiert: [LAW-CH.md](LAW-CH.md).
- **Mahnwesen so gut wie möglich**: Zahlungserinnerung und Mahnungen, ausbaubar — Gebühren,
  Verzugszins, später mehr.
- **Ein Einzahlungsschein pro Schreiben.** Der Kunde bekommt nie zwei Einzahlungsscheine für einen
  Vorgang (z.B. Mahnung und Mahngebühr).
- **Proforma-Rechnungen** müssen abgedeckt werden können.
- **Debitor ist `usr_id`.** Firmen sind Benutzer ohne Login; wer sonst auf die Sachen eines
  Debitors zugreifen darf, kommt bei Bedarf dazu.
- **Noch nirgends im Einsatz.** Alles darf grundlegend umgebaut werden.

## Grundsätze

- **Internationaler Kern.** Generische Module kennen kein Land. Alles Nationale — QR-Rechnung,
  Kontenrahmen, MWST-Abrechnung, eine lokale Bank-API — lebt in einem eigenen Modul, benannt nach
  der Sache (`qrbill`, `blink`) oder mit Ländercode als Suffix (`fin.accounting.ch`).
- **Jede Schicht steht für sich.** Zahlung ohne Rechnung (Shop, Spende), Rechnungen ohne
  Buchhaltung, Buchhaltung ohne beides (Buchungen von Hand). Obere Schichten hören zu, untere
  kennen sie nie.
- **Gekoppelt über `ref` und Events, nicht über Fremdschlüssel.** `ref` ist `<module>:<id>`
  (`shop.order:12`, `fin.invoice:7`). Wem die Sache gehört, hört auf das Event und findet sie über
  `ref`.
- **Beträge sind Ganzzahlen in kleinster Einheit, immer mit Währung.** Dezimalstellen, Namen und
  Formatierung kommen aus [locale.currency](../module/locale.currency/); in einer Buchung
  verwendete Kurse werden mit der Buchung gespeichert.
- **`direction: in | out` überall, wo Geld oder Forderungen fliessen**, vom ersten Tag an — wie im
  messaging-Journal. Zuerst nur `in` zu bauen ist in Ordnung; die Spalte später nachzurüsten ist
  ein Umbau.
- **Die Aussenwelt ist die Quelle der Wahrheit.** Provider und Bank sagen, was geschehen ist; was
  ein Browser oder Webhook schickt, gilt nicht schon als wahr.
- **Bücher werden nur ergänzt.** Korrekturen sind Stornobuchungen, keine Änderungen — wie es
  Buchführungsgesetze fast überall verlangen.

## Gebaut

Jedes Modul beschreibt sich in seinem README: [fin](fin/README.md),
[fin.payment](fin.payment/README.md) mit den Providern `saferpay`, `btcpay`, `bitcoin`, `lightning`,
`qrbill`, `stripe`, `paypal` und `credit` (Guthaben eines Benutzers als Konto),
[fin.invoice](fin.invoice/README.md) mit `.reminder`, [fin.subscription](fin.subscription/README.md),
[fin.bank](fin.bank/README.md) mit `.camt`, [fin.accounting](fin.accounting/README.md) mit `.ch`,
[fin.hosting](fin.hosting/README.md), und das Backend `cms.backend.fin.*`.
Das PDF-Rendering ist das Core-Modul [pdf](../module/pdf/), nicht Teil von fin.

Abhängigkeiten zeigen nur nach unten: `fin.invoice`, `fin.bank` und die Provider → `fin.payment`;
`qrbill` → `fin.bank`, das sie begleicht; `fin.accounting` → `fin.invoice`, `fin.payment`.

## Offen

Als Nächstes, nach Bedarf:

- Ausgehende Zahlungen: offene erhaltene Rechnungen als pain.001-Datei für die Bank (`send`); die
  IBANs der Lieferanten sind vorhanden (`usr.iban`).
- „Versendet am" auf der Rechnung, nicht nur im messaging-Journal; Versand beim Ausstellen, als
  Einstellung.
- Ausgehende Zahlungen brauchen vor `send` auch eine Freigabe: einfacher Modulzugriff (Zugriff =
  Nutzung); Betragslimiten und Vier-Augen-Prinzip erst, wenn jemand sie braucht.
- Provider `transfer` (Banküberweisung, Referenz in der Mitteilung, abgeglichen wie `qrbill`) und
  `pain001` (ISO-20022-Zahlungsauftrag als Datei, bestätigt durch die Belastung im Kontoauszug).
- Bank-Importer: `ebics`, nationale Open-Banking-APIs (`blink` für CH, PSD2-Aggregatoren), CSV für
  PayPal und ähnliche; ein Event `bank:transaction`, sobald ein zweiter Konsument es braucht.
- Guthaben: einen Teil einer Zahlung damit begleichen; eingehendes Geld fürs Guthaben buchen.
- Rechnungen, offene Posten, Mahnwesen, Proforma, Korrekturen, MWST-Kategorien: umgesetzt; was
  offen ist und bestätigt werden muss, steht in [PLAN-invoice.md](PLAN-invoice.md).
- Ein Standardkonto pro Lieferant; mehrere Positionen pro Abo, anteilige Verrechnung.
- E-Rechnungsformate (Factur-X/ZUGFeRD, XRechnung, Peppol UBL); Exportformate einzelner Programme
  (Banana, Abacus, DATEV) — je ein eigenes Modul, sobald gebraucht.
- Bargeldrundung pro Währung; Stablecoins.

Unsicher, zu entscheiden, wenn es darauf ankommt:

- Parteien sind Benutzer (`usr`, Lieferanten ohne Login). Eine eigene Kontakttabelle erst, wenn
  Benutzer nicht mehr passen.
- Eine Postadresse pro Benutzer; eine abweichende Rechnungs- oder Lieferadresse steht auf der
  Rechnung oder Bestellung.
- Ein Preis pro Abo, keine anteilige Verrechnung; stornierte Rechnungen behalten ihre Abo-Perioden.
- Mehrwährungs-Buchhaltung (funktionale Währung, Neubewertung) — erst bei Bedarf.
- Zwei Hauptwährungen: die von fin (`fin.mainCurrency`, sonst die des Landes der Organisation) und
  die des Shops (`shp3_currency.main`, eine Tabelle, kompatibel mit dem PHP-Shop gehalten). Der Shop
  könnte der von fin folgen, sobald er darauf aufbaut.
- Gutschriften ohne Rechnung, und Gutschriften von Lieferanten.
- Übersetzungen: nur Sprachen, die die Site hat (`languages.all`) — eine Rechnung in einer anderen
  Sprache fällt auf die Standardsprache zurück, bis smalltext Zeilen statt einer Spalte pro Sprache
  speichert.
- Texte der Browser-Skripte (`pub/*.js`) werden noch im Core-Namespace übersetzt.
- Browser-Dateien importieren einander über Stores hinweg per relativem Pfad
  (`../../cms.backend.fin`): innerhalb eines Stores in Ordnung; über Stores hinweg eine Core-Frage.

Vor dem Aufschalten auf einem Server: `fc-match Arial` muss Liberation Sans oder Arial liefern
(Schrift der QR-Rechnung).

### Aus dem Code-Review (2026-10)

Gefunden, noch nicht erledigt — vor dem Umsetzen prüfen.

Struktur:

- Abos: Das Löschen eines Plans oder eines nie verrechneten Abos liegt in der Backend-API; gehört
  zu `fin.subscription` (dessen Fehler dann im Backend übersetzt).
- Den Backend-APIs für Parteien und Abos fehlt das `try … errMsg`, das die anderen haben.
- Settings-Defaults im Code wiederholt (`?? 30`, `|| "{year}-{n}"`, die mempool-URL): heute nötig,
  weil Blatt-Lesezugriffe (und `fakeSettings` in den Tests) keine Schema-Defaults anwenden. Eine
  Core-Frage.
- Noch kopiert in den Backend-Seiten: `option()`, `field()`, die Anzahl überfälliger Rechnungen
  (Übersicht und Rechnungs-Widget), die Abfrage der Benutzerauswahl. Das Buchhaltungsjournal mit
  `PER_PAGE + 1` statt `pager()`.
- Buchhaltungs-Widget und -Übersicht nehmen standardmässig das Kalenderjahr, obwohl das
  Geschäftsjahr an einem beliebigen Tag enden kann (`close()`).
- `dataOf(payment)` in fünf Providern; `Urls` in `fin.payment/mod.ts` wiederholt `lib/url.ts`.
- Saferpay `sync` gibt die rohe Antwort als Status zurück, wenn es keine Transaktion gibt.
- Der Typ `Read` der Inbox wiederholt ihr `SCHEMA`.
- `fin.invoice:` noch von Hand geschrieben in den Bank-Vorschlägen und in `refLink`.

Entscheide, die sich ändern können, stehen Modul für Modul im jeweiligen README („Decisions that
may change").
