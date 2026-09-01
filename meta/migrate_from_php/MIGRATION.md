# Migration eines PHP-Projekts

## Kurzfassung

```sh
tools/new-project.sh <site-ordner-im-backup> <db> <kurzname> [port]   # entpackt, DBs, Gerüst
# Site-Templates nach site-templates/ portieren, dann:
cp -a qino-<kurzname>/site-templates/. qino-<kurzname>/qg/
(cd qino-<kurzname> && deno task start)                            # migriert beim ersten Start
tools/compare.sh <db> <port> <kurzname> [sprache] [php-basis-url]     # PHP gegen qino, Seite für Seite
```

Dazwischen von Hand: die eigenen Templates der Site (`qg/<modul>/index.php`) nach
`site-templates/<modul>/index.ts` portieren — `tools/new-project.sh` nennt am Schluss genau die, die auch
eingebunden werden. Sie liegen dort resetfest und werden vor dem ersten Start nach `qg/` kopiert;
`migrate_from_php` verschiebt sie zusammen mit den übrigen Site-Daten nach `data/`.

Welche Module noch fehlen, steht als Kommentarblock im erzeugten `server.ts`: kundenspezifische
PHP-Module müssen entweder portiert (`cms-legacy`-Store) oder einem aktuellen Modul zugeordnet
werden (`renamedModules.ts`).

Der Rest dieses Dokuments beschreibt, warum die Schritte so aussehen.

---



Protokoll der Schritte, um ein Vanilla-CMS-Projekt aus dem Plesk-Backup lokal zum Laufen zu
bringen — einmal als PHP-Original und einmal als qino-Version, damit man beide vergleichen kann.

Validiert mit **swisspremiumservices.com** (DB `sps`), **schule-lutzenberg.ch**
(DB `schule_lberg`), **bioforskin.ch** (DB `biotuskin`, inklusive `shp3`),
**outdoor-boutique-hotel.com** (DB `outdoor`), **seiler-spiess.ch**
(DB `seiler_spiess`, eigener Plesk-`www-root`) und **swingcopate.ch** (DB `swingcopate`,
zweisprachig und mit Legacy-Events) sowie **louiselouise.ch** (DB `louiselo`, eigener
Plesk-`www-root`, altes Custom-3-Layout und Nivo-Slider).

## 0. Ausgangslage

- Backup: `php/backup_vanilla-cms.org_2608101455(1).tar` (3.6 GB, Plesk-Format)
- Lokal vorhanden: PHP 8.3.6 mit mysqli/pdo_mysql/gd/mbstring/zip, MariaDB auf `localhost:3306`
- Zugang lokale DB: `admin`, Passwort aus `$MYSQL_PASS` — die Skripte verlangen die Variable

## 1. Backup verstehen

Das Tar enthält keine Nutzdaten direkt, sondern verschachtelte `.tzst` (tar + zstd):

| Eintrag | Inhalt |
| --- | --- |
| `backup_info_*.xml` | Plesk-Metadaten: Sites, www-root, Datenbanken |
| `databases/<db>_1/backup_sqldump_*.tzst` | je ein SQL-Dump pro Datenbank (14 Stück) |
| `backup_user-data_*.tzst` | **alle** Site-Dateien, 3.4 GB |

```sh
cd php
tar tvf 'backup_vanilla-cms.org_2608101455(1).tar'          # Übersicht
tar xf  'backup_vanilla-cms.org_2608101455(1).tar' backup_info_2608101455.xml
tar xf  'backup_vanilla-cms.org_2608101455(1).tar' databases   # alle Dumps, 227 MB
```

Site→DB steht nicht in der XML (die Datenbanken hängen am Abo, nicht an der Site) — die
Zuordnung steht in der `index.php` der jeweiligen Site (`qg_dbname`).

Der Verzeichnisname im Archiv ist nicht immer der Site-Name. Sites des Abos `vanilla-cms.org`
(`<site … parent-domain-name="vanilla-cms.org">`) liegen unter `<domain>.vanilla-cms.org/` — das
Argument von `tools/new-project.sh`. Sites mit eigenem Abo, im Backup `seiler-spiess.ch` und
`louiselouise.ch`, liegen dagegen unter `<domain>/httpdocs/`; für sie ist dieser Pfad das Argument.
`tools/new-project.sh` bricht mit dieser Erklärung ab, wenn es das Verzeichnis nicht findet.

## 2. Site-Dateien auspacken

Ein einziger Durchgang, ohne die 3.4 GB als Datei zwischenzulagern:

```sh
mkdir -p sites-data
tar xOf 'backup_vanilla-cms.org_2608101455(1).tar' backup_user-data_2608101455.tzst \
  | zstd -dc \
  | tar xv -C sites-data --wildcards '*swisspremiumservices*'
```

Ergebnis: `php/sites-data/swisspremiumservices.com.vanilla-cms.org/` (51 MB) mit
`index.php`, `m/` (CMS-Kern + Module), `qg/` (Daten: Dateien, Modul-Ordner), `cache/`.

## 3. SQL-Dump entpacken

Die `.tzst` sind tar-in-zstd, der Dump liegt als einzelne Datei darin:

```sh
zstd -dc databases/sps_1/backup_sqldump_2608101455.tzst | tar xO > sps.sql
```

## 4. Zwei Datenbanken anlegen

Eine für das PHP-Original, eine Kopie für qino — sonst würde die qino-Migration die DB unter dem
laufenden PHP wegziehen.

```sh
mysql -uadmin -p… -e "CREATE DATABASE sps CHARACTER SET utf8mb4; CREATE DATABASE sps_qino CHARACTER SET utf8mb4;"
mysql -uadmin -p… sps      < sps.sql
mysql -uadmin -p… sps_qino < sps.sql
```

46 Tabellen, 165 Seiten, 4 Benutzer.

## 5. PHP-Original lokal starten

Der Apache-DocumentRoot ist `/var/www/workplace`, PHP-Projekte liegen direkt darunter (wie `v9/`).
Die Site kommt also dorthin, nicht auf einen eigenen Port:

```sh
mv sites-data/swisspremiumservices.com.vanilla-cms.org /var/www/workplace/sps
cd /var/www/workplace/sps
chgrp -R www-data . && chmod -R g+rX . && chmod -R g+w cache qg
find . -type d -exec chmod g+s {} +          # sonst 403, die Dateien kamen als tobias:tobias
```

In `index.php` nur die Zugangsdaten und HTTPS anpassen — `qg_dbuser` fällt sonst auf `qg_dbname`
zurück (`m/core/sysinit.php:79-81`):

```php
define('QG_HTTPS', false);   // war true
define('qg_dbname', 'sps');
define('qg_dbuser', 'admin'); // neu
define('qg_dbpass', '…');
```

Läuft: <http://localhost/sps/?cmspid=2> und <http://localhost/sps/en/home> — „SWISS PREMIUM
SERVICES", 17.5 KB, keine Fatals.

## 6. qino-Instanz aufsetzen

`migration-work/qino-sps/` mit eigenem `dir`. Wichtig: das Legacy-Verzeichnis `qg/` der Site muss **im
dir liegen**, denn `migrate_from_php` verschiebt `qg/` → `data/`.

```sh
mkdir qino-sps
cp -a sites-data/swisspremiumservices.com.vanilla-cms.org/qg qino-sps/qg
```

`qino-sps/server.ts` lädt `cms` plus den Store `qino/meta` mit `migrate_from_php`. Der Ordner muss
in `deno.json` als Workspace-Mitglied stehen, damit `@qino/qino` auf das lokale Paket zeigt und
dessen Abhängigkeiten aufgelöst werden (`Import "@qino/item/..." not a dependency`).

Die Modulliste in `server.ts` schreibt `tools/new-project.sh` aus den Daten der Site: jedes `page.module`,
umbenannt wie `renamedModules.ts` es tut, dazu rekursiv alles aus den `needs`-Deklarationen. Was es
in `qino/module/` gibt, landet im Standard-Store, was in `cms-legacy/` liegt im Legacy-Store, der
Rest als Kommentarblock am Ende — genau die Module, die noch portiert werden müssen. Vorlage ist
[server.template.ts](tools/server.template.ts).

Die Legacy-Module werden dabei **einzeln** aufgezählt statt mit `legacy.addAll()`: im Store liegen
inzwischen auch Module, die `shp3` brauchen (`cms.cont.shp3.currency_chooser`), und die reissen den
Start einer Site ohne Shop ab.

Ein erneuter Aufruf von `tools/new-project.sh` legt nur an, was fehlt — Site-Ordner, Datenbanken und
`server.ts` bleiben stehen. Wer neu importieren will, nimmt den Reset weiter unten.

## 7. Datenbank vorbereiten (vor dem ersten qino-Start)

Die Legacy-Tabellen haben Spalten, die `NOT NULL` ohne Default sind und die qino nie schreibt —
jedes `INSERT` in die Tabelle scheitert daran. `migrate_from_php` repariert sie, kommt aber zu spät:
`qg_setting` und `module` werden beschrieben, **bevor** irgendein Modul installiert ist. Deshalb
verliert die Vorbereitung nur die Constraint (Daten bleiben), das Löschen macht danach die Migration.

```sh
tools/prepare-db.sh sps_qino
```

[prepare-db.sh](tools/prepare-db.sh) vergleicht `information_schema` mit den tatsächlich exportierten
Schemata aller lokalen Module (`dbschema.json` und direkt in `plugin.ts` definierte `dbSchema`)
und macht jede Spalte nullable, die qino nicht kennt. Bei sps sind das 6:

```sql
ALTER TABLE `module` MODIFY COLUMN `title_id` int(10) NULL;
ALTER TABLE `page`   MODIFY COLUMN `_cache` text NULL;
ALTER TABLE `client` MODIFY COLUMN `client1_request_json` text NULL;
ALTER TABLE `client` MODIFY COLUMN `client1_response_json` text NULL;
ALTER TABLE `grp`    MODIFY COLUMN `page_access` tinyint(1) NULL;
ALTER TABLE `mail`   MODIFY COLUMN `mail1_template` text NULL;
```

Dazu von Hand, weil qino Settings noch vor allem anderen liest und `module.access` Werte trägt,
die erst migriert werden müssen:

```sh
mysql -uadmin -p… sps_qino -e "ALTER TABLE qg_setting DROP COLUMN w;
  ALTER TABLE module MODIFY COLUMN access TINYINT(1) NOT NULL DEFAULT 0;"
```

Was danach `migrate_from_php` erledigt:

| Spalte | Behandlung |
| --- | --- |
| `module.access`, `module.title_id`, `page._cache` | gelöscht (in qino ungenutzt), `access` vorher nach `cms_access` migriert |
| `client.client1_*`, `mail.mail1_template` | bleiben — enthalten Daten der PHP-Module `client1`/`mail1` |

## 8. Migration laufen lassen

```sh
cd qino-sps && deno task start
```

```
[migrate_from_php] dropped module.title_id
[migrate_from_php] dropped page._cache
[migrate_from_php] client.client1_request_json is nullable now
[cms] migrated 53 legacy page settings into page.settings
[migrate_from_php] module.access → cms_access: 6 rows
[migrate_from_php] grp.page_access → cms_access: 1 rows
[migrate_from_php] qg/ → data/: 38 moved
[migrate_from_php] migrated 7 app settings, 0 json settings
```

<http://localhost:8091/en/home> antwortet mit 200.

### Reset für einen erneuten Durchlauf

Die Migration ist einmalig — sie verschiebt `qg/` und ändert das Schema:

```sh
mysql -uadmin -p… -e "DROP DATABASE sps_qino; CREATE DATABASE sps_qino CHARACTER SET utf8mb4;"
mysql -uadmin -p… sps_qino < sps.sql
mysql -uadmin -p… sps_qino -e "ALTER TABLE qg_setting DROP COLUMN w;
  ALTER TABLE module MODIFY COLUMN access TINYINT(1) NOT NULL DEFAULT 0;"
tools/prepare-db.sh sps_qino
rm -rf qino-sps/data qino-sps/cache qino-sps/qg qino-sps/tmp
cp -a /var/www/workplace/sps/qg qino-sps/qg
cp -a qino-sps/site-templates/. qino-sps/qg/   # portierte Templates zurück
```

Die von Hand portierten Templates liegen deshalb in `qino-sps/site-templates/` und nicht nur in
`data/` — sonst löscht der Reset sie mit.

## 9. Fehlende Module: Store `cms-legacy`

Jede Seite verweist über `page.module` auf einen PHP-Modulnamen. Von 42 verwendeten kennt qino 22
unter demselben Namen, 20 nicht — ohne Modul rendert die Seite leer. Die alten Namen leben deshalb
in einem eigenen Store: [cms-legacy](../../cms-legacy/README.md).

Der Store enthält inzwischen die für beide Testprojekte benötigten Layout-, Inhalts-, Slideshow-
und Galerie-Module. `cms.cont.nav2` ist dabei nur ein Re-Export von `cms.cont.nav3` — der Nachfolger
hat exakt dieselben Einstellungsnamen. Die vollständige Liste und die Abgrenzung zu echten
Umbenennungen stehen in [qino/cms-legacy/README.md](../../cms-legacy/README.md).

Der Port ist klein, weil qinos `cms.layout.custom.9` dasselbe Muster hat — das Modul ist nur eine
Hülle, das Layout selbst ist Site-Daten:

| PHP | qino |
| --- | --- |
| `qg/<module>/index.php` | `data/<module>/index.ts` |
| `layoutCustom*::layoutPage()` | `cms.layoutPage(module)` — gibt es schon |
| `$LPage->Cont('nav')` | `lpage.cont("nav")` |
| `html::addCssFile(...)` | `ctx.res.html.styles.add(...)` |

Die Site-Templates `data/cms.layout.custom.6/index.php` und `data/cms.cont.section3/index.php`
wurden von Hand nach `index.ts` portiert. Die Seite rendert damit Struktur, CSS, JS und Schriften
der Site.

Zusätzlich installiert `server.ts` die Module, die es in qino schon gibt (`cms.text`, `cms.image2`,
`cms.cont.flexible`, `cms.cont.text`, `cms.cont.image2`, `cms.cont.login4`, `cms.layout.login`).

> **Achtung beim Reset:** `data/` wird gelöscht. Portierte Templates deshalb immer unter
> `site-templates/` behalten und nach dem Wiederherstellen von `qg/` erneut darüberkopieren.

## Zweiter Testlauf: schule-lutzenberg.ch

Der zweite Durchlauf erfolgte nur über die dokumentierten Helfer und wurde dreimal aus dem
unveränderten Dump neu gestartet:

```sh
tools/new-project.sh schule-lutzenberg.ch.vanilla-cms.org schule_lberg schule 8092
# qino-schule/site-templates/cms.layout.custom.7/index.ts portieren
cp -a qino-schule/site-templates/. qino-schule/qg/
(cd qino-schule && deno task start)
tools/compare.sh schule_lberg 8092 schule de
```

Ergebnis: 45 Tabellen, 138 Seiten, alle Tabellen in der qino-Kopie auf InnoDB. Startseite,
Navigation, Login, Kontaktformular und Bildergalerie antworten mit demselben HTTP-Status wie das
PHP-Original. Die sichtbaren Texte der Inhaltsseiten stimmen im automatischen Vergleich zu
95–99 % überein; kurze Systemseiten liegen wegen unterschiedlicher Standardtexte bei 90–91 %.
`service/impressum` liefert in beiden Systemen 401. Der visuelle Vergleich der Startseite stimmt
bei Layout, Logo und Slideshow überein.

Dieser Lauf hat drei generische Lücken sichtbar gemacht und geschlossen:

1. `core.langs` war vor der Migration bereits leer gecacht. Nach `qg.langs` → `core.langs` wird
   deshalb auch der laufende Settings- und Sprachcache aktualisiert; der erste Prozess rendert nun
   sofort Deutsch und braucht keinen Neustart.
2. `cms.cont.form1(.fields2)` wird strukturell nach `cms.cont.form2(.fields1)` migriert. Dabei
   bleiben Feld-IDs, Empfänger, Buttons und der vorhandene Bestätigungstext erhalten.
3. Die gemeinsamen Legacy-Ports für `cms.layout.custom.7`, `cms.cont.slideshow.schwups2` und
   `cms.cont.gallery.photoswipe1` liegen im `cms-legacy`-Store. Nur das eigentliche Layout-Template
   der Schule bleibt projektspezifisch.

`tools/compare.sh` vergleicht bewusst sichtbaren Text statt HTML-Bytes, zeigt beide HTTP-Status und
beschränkt sich auf öffentliche Seiten. Unterschiedlich schlankes Markup erzeugt dadurch keine
irreführenden Abweichungen mehr.

Wenn Apache lokal nicht läuft, kann das PHP-Original vorübergehend auf einem anderen Port gestartet
und die Basis-URL als fünftes Argument übergeben werden:

```sh
php -S 127.0.0.1:8090 -t /var/www/workplace
tools/compare.sh schule_lberg 8092 schule de http://127.0.0.1:8090/schule
```

## Dritter Testlauf: bioforskin.ch mit Shop

Der dritte Durchlauf testet zusätzlich eine Site mit `shp3`, kundenspezifischem Layout und bewusst
gesperrter öffentlicher Ansicht:

```sh
tools/new-project.sh bioforskin.ch.vanilla-cms.org biotuskin bioforskin 8093
# vier Site-Templates portieren und nach qg/ kopieren
(cd qino-bioforskin && deno task start)
php -S 127.0.0.1:8090 -t /var/www/workplace
tools/compare.sh biotuskin 8093 bioforskin de http://127.0.0.1:8090/bioforskin
```

Ein vollständiger Neuaufbau aus dem unveränderten Dump migriert 213 Seiten und 70 Seiten-Settings,
zwei `form1`-Formulare nach `form2`, eine `table1` nach `table2`, zwei `text.cd` nach `text` und
`shp3.order.cart3` nach `shp3.order.cart1`. Alle 63 MyISAM-Tabellen werden vor dem Start zu InnoDB;
vier Legacy-Datumsfelder werden verlustfrei in Unix-Zeit überführt. Nach einem zweiten Start waren
alle fünf für die Startseite ergänzten Legacy-Ports weiterhin importiert — dieser Neustarttest hat
einen zunächst fehlenden Store-Katalogeintrag gefunden.

Die anonyme Startseite antwortet in PHP und qino mit HTTP 200 und derselben Wartungsmeldung. Im
öffentlichen Seitenvergleich stimmen 16 von 19 Seiten bei Status und sichtbarem Text exakt überein.
Die drei kurzen Systemseiten liegen wegen anderer Standardformulierungen bei 80–83 %;
`service/impressum` liefert in beiden Systemen 401.

Dieser Lauf hat zwei weitere generische Lücken geschlossen:

1. `tools/prepare-db.sh` liest nun die wirklich exportierten Schemata der lokalen Stores. Nur nach
   `dbschema.json` zu suchen übersah Inline-`dbSchema`, unter anderem `currency.name/sign` und
   mehrere `country`-Spalten, und ließ dadurch den ersten Shop-Start scheitern.
2. Reine Nachfolger werden während der Migration umbenannt: `cms.cont.text.cd` → `cms.cont.text`
   und `cms.cont.shp3.order.cart3` → `cms.cont.shp3.order.cart1`. Die projektspezifischen Module für
   Zitat, Bildzeile, Produktübersicht, Währungswahl und Text-Slider bleiben dagegen als Ports im
   `cms-legacy`-Store.

Die Site zeigt ihren eigentlichen Shop nur angemeldeten Benutzern. Ein Login-Vergleich bestätigt
Layout und die genannten Startseitenmodule; er ist kein vollständiger Shop-Abnahmetest. Noch von
Hand zu portieren sind insbesondere `cms.cont.shp3.product.cd`, `header.cd`, `intro.cd`,
`text_bild.cd`, die Konto-/Rechtstextmodule sowie die fünf nach `data/cms.cont.ts/` verschobenen
PHP-Dateien. Die öffentliche Wartungsseite und der Migrationsmechanismus sind davon nicht betroffen.

## Vierter Testlauf: outdoor-boutique-hotel.com

Zweisprachige Site (de/en) ohne Shop, dafür mit einem ganzen Satz eigener `.cd`-Module — der Lauf,
der die Werkzeuge selbst geprüft hat:

```sh
tools/new-project.sh outdoor-boutique-hotel.com.vanilla-cms.org outdoor outdoor 8094
# cms.layout.custom.6 und cms.cont.section3 portieren, dann
cp -a qino-outdoor/site-templates/. qino-outdoor/qg/
(cd qino-outdoor && deno task start)
tools/compare.sh outdoor 8094 outdoor de
tools/compare.sh outdoor 8094 outdoor en
```

45 Seiten-Settings, 93 Dateien nach `data/`, 67 Legacy-Selektoren in 10 CSS-Dateien, 45 MyISAM-Tabellen
nach InnoDB. Ergebnis: alle neun öffentlichen Seiten antworten in beiden Sprachen mit demselben
HTTP-Status, die Startseite stimmt im sichtbaren Text zu 100 % überein (de 3463, en 3720 Zeichen).
Die kurzen Systemseiten liegen wegen anderer Standardtexte bei 87–91 %. Login, Backend-Dashboard,
Seitenbaum, Benutzer, Module und System liefern angemeldet 200; Inline-Bearbeitung (`?cms_editmode=1`)
ebenfalls.

Portiert wurden zwei Site-Templates (`cms.layout.custom.6`, `cms.cont.section3`) und acht Module in
den `cms-legacy`-Store: `cd.link_box`, `cd.fullscreen`, `cd.text`, `cd.2_bilder`, `cd.image_height`,
`cd.slideshow`, `icons1`, `stretchedItems1`. Bei diesem Lauf blieben fünf Backendmodule
(`app1`, `developer`, `superuser.client1`, `superuser.performance`, `webmaster`) und
`cms.cont.impressum2` ohne Pendant; `impressum2` wurde im sechsten Lauf portiert. Die
Impressumsseite war hier in beiden Systemen ohnehin nur angemeldet lesbar.

Was der Lauf an den Werkzeugen und am Kern geändert hat:

1. `tools/new-project.sh` erzeugt `server.ts` jetzt aus den Modulen der Site statt per `sed` aus dem
   sps-Projekt — inklusive `needs`-Auflösung und Liste der fehlenden Module.
2. `tools/new-project.sh` importiert nur noch fehlende Datenbanken. Vorher warf ein zweiter Aufruf die
   bereits gelaufene Migration weg, ohne es zu sagen.
3. Der Hinweis auf zu portierende Site-Templates zeigt nur noch die, die das Modul auch einbindet.
   Der Installer kopiert `custom/`-Ordner nach `qg/`, in denen manchmal eine `index.php` liegt, die
   kein Modul liest (`cms.cont.quote.cd` bei bioforskin).
4. `cms.cont.table1` → `cms.cont.table2` ist jetzt eine Umbenennung. `table2` kennt dazu die zwei
   Legacy-Settings `units` und `direction`, und `migrateTable1` schreibt `units: "%"` dort hin, wo
   das PHP-Modul es als Default annahm — sonst würde aus `33.3 %` Spaltenbreite `33.3 px`.
5. `cms_text($Cont,'title')` meint in PHP den **Knotentitel**, nicht einen Text namens `title`.
   `lib/text.ts` im Legacy-Store bildet das ab; ein Port mit `showText("title")` schreibt statt
   dessen eine zweite Textzeile und lässt die halbe Seite leer.
6. `sectionAttr()` in `cms-legacy/lib/bg.ts` fasst zusammen, was alle Legacy-Sections teilen:
   Hintergrundbild samt gespeichertem Bildausschnitt, `background-color` und weisse Schrift, sobald
   diese Farbe dunkel ist.
7. `tools/prepare-db.sh` braucht für seinen Schema-Abgleich `--allow-env`; die Plugins ziehen npm-Pakete
   nach, die die Umgebung nach Farbunterstützung fragen.

Zwei Unterschiede bleiben bewusst stehen:

- **Automatische URLs können sich ändern.** Von 254 `page_url`-Zeilen unterscheiden sich zwei:
  `en/backend/module` → `.../modules` und `cmslayoutcustom6` → `cms-layout-custom-6`. Betroffen sind
  nur Seiten ohne eigene URL (`page_url.custom = 0`), deren Titel qinos `urlize` anders übersetzt.
  Öffentliche Inhaltsseiten waren in allen vier Läufen nicht dabei; bei einer echten Migration
  gehört diese Abfrage trotzdem vor den Umzug.
- **`mailto:`-Adressen stehen im Klartext.** PHP ersetzte sie in der Ausgabe durch einen
  hashAction-Token (`mailto:mail<hash>…`), qino schreibt die Adresse hin. Das ist der einzige
  verbleibende Textunterschied der Startseite.

## Fünfter Testlauf: seiler-spiess.ch mit eigenem `www-root`

Dieser Lauf prüft den oben beschriebenen Sonderfall einer Site, deren Dateien im gemeinsamen
User-Archiv unter einem Pfad mit Unterordner liegen:

```sh
tools/new-project.sh seiler-spiess.ch/httpdocs seiler_spiess seiler 8095
# cms.cont.section3 und cms.layout.custom.7 portieren, dann
cp -a qino-seiler/site-templates/. qino-seiler/qg/
(cd qino-seiler && deno task start)
tools/compare.sh seiler_spiess 8095 seiler de
```

79 bestehende Seiten, 44 MyISAM-Tabellen, 11 Seiten-Settings, 10 Dateien nach `data/` und 10
Legacy-Selektoren in drei CSS-Dateien wurden migriert. Nach der Migration sind alle Tabellen
InnoDB. Ein zweiter Start importiert die beiden Legacy-Module und ihre Site-Templates erneut
fehlerfrei; Startseite, Login und die statischen CSS-/JS-Dateien antworten mit HTTP 200.

Alle zehn öffentlichen deutschen URLs liefern in PHP und qino denselben HTTP-Status. Fünf davon
stimmen im sichtbaren Text exakt überein. Die Startseite liegt bei 98 %; ihre einzigen Unterschiede
sind die zwei `mailto:`-Adressen, die PHP mit dem oben genannten Token verschleiert. Die kurzen
Such-, Login- und Rechte-Seiten liegen wegen anderer Standardformulierungen bei 90–92 %.
Englische URL-Zeilen sind vorhanden, aber keine englische Seite ist öffentlich.

Der Lauf hat drei Werkzeuglücken und eine gemeinsame Modul-Lücke geschlossen:

1. `tools/new-project.sh` akzeptiert sichere relative Unterpfade wie `seiler-spiess.ch/httpdocs`.
   Zuvor widersprach seine Eingabeprüfung der dokumentierten Plesk-Verzeichnisstruktur. Jedes
   Segment muss alphanumerisch beginnen; absolute Pfade sowie `.`/`..` werden weiterhin abgelehnt.
2. Nach dem Verschieben eines solchen Unterpfads entfernt das Skript auch dessen leere
   Elternverzeichnisse unter `sites-data/`. Auch eine nicht vorhandene Site endet jetzt mit der
   erklärenden Fehlermeldung und einem aufgeräumten Temp-Ordner statt mitten in der `pipefail`-Pipe.
3. Setup-Entscheidungen verwenden keine früh abbrechenden `head`-/`grep -q`-Pipes mehr. Mit
   `set -o pipefail` konnte deren SIGPIPE als Fehler gelten; beim Datenbanktest löste das einen
   erneuten Importversuch aus, obwohl die Datenbank bereits existierte.
4. Das gemeinsame `cms.cont.section3`-Schema enthält nun auch `background-color` und `fixed`;
   beide Einstellungen wurden schon gerendert beziehungsweise von Site-Templates verwendet,
   waren im Editor aber nicht beschrieben.

Bei diesem Lauf blieben `cms.backend.app1`, `cms.backend.superuser.client1`,
`cms.backend.webmaster` und `cms.cont.impressum2` ohne qino-Pendant; `impressum2` wurde im sechsten
Lauf portiert. Die ersten drei betreffen nur das alte Backend, die Impressumsseite liefert hier in
beiden Systemen 401. Die öffentliche Site ist davon nicht betroffen.

## Sechster Testlauf: swingcopate.ch mit Legacy-Events

Der sechste Lauf prüft eine zweisprachige Site mit Kalendern, Event-Kategorien, Event-Details,
historischen Teilnehmerdaten und mehreren kleinen Layoutmodulen:

```sh
tools/new-project.sh swingcopate.ch.vanilla-cms.org swingcopate swingcopate 8096
# cms.layout.custom.6 portieren, dann
cp -a qino-swingcopate/site-templates/. qino-swingcopate/qg/
(cd qino-swingcopate && deno task start)
tools/compare.sh swingcopate 8096 swingcopate de
tools/compare.sh swingcopate 8096 swingcopate en
```

Der erste Start migriert 156 Seiten-Settings, drei `form1`-Formulare, 137 Dateien und 57
Legacy-CSS-Selektoren; alle 53 Tabellen der Kopie laufen danach mit InnoDB. Die 140 Event-Termine
und 79 historischen Teilnehmerzeilen bleiben erhalten. Ein zweiter Start war ohne weitere
Migrationseingriffe erfolgreich.

Alle jeweils 42 öffentlichen deutschen und englischen URLs liefern in PHP und qino denselben
HTTP-Status. Statische Inhaltsseiten stimmen meist exakt, Profile zu 96–99 % und die drei
Kursübersichten nach Bereinigung der PHP-Debugausgabe gerundet zu 100 % überein. Die generischen
Ports umfassen Spalten, Abstand, Parallax, native/YouTube-Videos, Seitenübersicht, Impressum,
Datenschutz sowie vier Event-Leseansichten. Die Event-Anmeldung und -Verwaltung sind ausdrücklich
nicht portiert: sie würden Teilnehmerdaten schreiben und E-Mails versenden und brauchen vor einer
Produktivmigration einen eigenen Fach- und Zustelltest.

Dieser Lauf hat außerdem eine Messlücke geschlossen: PHP 8.3 schreibt für alte `strftime()`-Aufrufe
tausende verlinkte Deprecation-Hinweise mitten in die HTML-Ausgabe. `tools/compare.sh` entfernt nur diese
eindeutig als `/editor?file=…` markierten Debugblöcke aus dem Textvergleich und meldet ihre Anzahl
separat. Fehler des Originals bleiben damit sichtbar, verfälschen aber nicht länger den
Inhalts-Score. Bei der Datenschutzseite weist das PHP-Original zusätzlich einen fehlerhaften, nicht
quotierten Zugriff auf die reservierte Spalte `qg_setting.offset` aus; der qino-Port wertet diese
Legacy-Einstellung mit dem SQL-Identifier-Helper aus.

Ohne qino-Pendant bleiben sechs reine Backendmodule (`app1`, `db`, `event2`, `client1`,
`performance`, `webmaster`). Sie beeinflussen die anonymen Seitentests nicht.

## Siebter Testlauf: louiselouise.ch mit altem Custom-3-Layout

Wie seiler-spiess liegt die Site in einem eigenen Plesk-Abo. Sie prüft zusätzlich bereits
vorhandene produktive DB-Zugangsdaten, ein über `customTemplatePath()` eingebundenes Layout sowie
alte Navigation, absolute Positionierung und einen Nivo-Slider:

```sh
tools/new-project.sh louiselouise.ch/httpdocs louiselo louiselouise 8098
# cms.layout.custom.3 portieren, dann
cp -a qino-louiselouise/site-templates/. qino-louiselouise/qg/
(cd qino-louiselouise && deno task start)
tools/compare.sh louiselo 8098 louiselouise de
```

Der erste Start migriert 27 Seiten-Settings, ein `form1`-Formular, 23 Datenordner und 37
Modul-Selektoren; die Vorbereitung konvertiert 44 MyISAM-Tabellen nach InnoDB. Portiert wurden
`cms.layout.custom.3`, `cms.cont.navigation.horizontal`, `cms.cont.freePosition1` und
`cms.cont.slider.nivoSlider`. Der Slider kommt ohne das alte jQuery-Plugin aus, liest aber dieselben
Bilder und Einstellungen.

Alle 14 öffentlichen deutschen URLs liefern in PHP und qino HTTP 200. Die fünf eigentlichen
Inhaltsseiten liegen bei 95–100 % sichtbarer Textübereinstimmung (`home` 95 %, `arbeiten` 98 %,
`kontakt` 95 %, `resuemee` 99 %, `erfahrung` 100 %); `ich-p2` stimmt ebenfalls zu 100 % überein.
Der visuelle Headless-Vergleich deckt Navigation, Home-Zustand, Layout und Slider ab. Die niedrigere
Quote der internen Layout-Testseite entsteht durch leere Legacy-Platzhalter, nicht durch eine
öffentliche Inhaltsseite.

Der Lauf hat fünf Werkzeuglücken geschlossen:

1. `tools/new-project.sh` ersetzt lokale DB-Zugangsdaten jetzt auch dann, wenn `qg_dbuser` im Legacy-
   `index.php` bereits definiert ist. Zuvor blieben in diesem Fall die produktiven Credentials
   stehen und das PHP-Original konnte lokal nicht verbinden.
2. Eine Site ohne erkanntes Template beendet das Setup nicht mehr wegen des letzten erfolglosen
   `grep` mit Status 1. Der idempotente zweite Lauf endet regulär mit „fertig“.
3. Die Template-Erkennung kennt neben direkten `qg/…/index.php`-Includes auch
   `customTemplatePath()`. Dadurch wird das Layout von louiselouise zuverlässig zum Portieren
   genannt.
4. `migrateCss` behandelt nun auch `.-pid123` und absolute `/qg/<module>/`-Assetpfade. Erstere
   steuern hier den besonderen Home-Zustand; letztere liefern das Logo unabhängig vom Mountpfad.
   Ein eigener Migrationstest schützt beide Umschreibungen.
5. `schmerz_qino` enthielt den Legacy-Doppelknoten `cms.backend`: eigener Wert `83` plus Kind
   `lastpage=83`. qino erlaubt absichtlich nur Wert **oder** Ast. `migrate_from_php` entfernt deshalb
   das obsolete `cms.backend.lastpage`; `cms.backend` bleibt das Integer-Blatt mit der Backend-ID.

Ohne qino-Pendant bleiben `cms.backend.superuser.client1`,
`cms.backend.superuser.performance` und `cms.backend.webmaster`. Das sind ausschließlich alte
Backendseiten; sie beeinflussen die öffentliche Site nicht.

## 10. Login

<http://localhost:8091/en/system/login> — funktioniert. Nötig waren nur `cms.cont.login4` und
`cms.layout.login`; beide gibt es in qino unter demselben Namen.

Die Passwörter der PHP-Installation gelten weiter: qino ersetzt beim Prüfen PHPs `$2y$`-Präfix
durch `$2b$` ([login.ts:80](../../module/core/lib/auth/login.ts#L80)), bcrypt ist ansonsten identisch.
Getestet mit einem gesetzten Testpasswort auf `usr` 3 in der **Kopie-DB** — richtiges Passwort
ergibt eine Session mit „Log out", falsches den Fehlertext.

> Wer zum Testen ein Passwort direkt per SQL setzt, wird beim Login bedient — `auth()` liest die
> Zeile frisch. Andere geladene Rows sehen Direktschreiber weiterhin nicht: die Identity-Map
> verwirft nur, was durch die App geschrieben wurde (`db.table("usr").rowTtl` setzt optional ein Zeitlimit).

## Stand des SPS-Referenzlaufs

| | PHP | qino |
| --- | --- | --- |
| | <http://localhost/sps/?cmspid=2> | <http://localhost:8091/> |
| Startseite | 17.5 KB | 7.0 KB |
| Navigation | ✓ | ✓ (gleiche Ausgabe, `cmsChilds1` …) |
| Login | ✓ | ✓ |
| Backend | ✓ | ✓ — 9.1 KB, Dashboard, Baum, Users, Module |
| Inline-Bearbeitung | ✓ | ✓ (`?cms_editmode=1`) |
| Module nachinstallieren | — | ✓ `/en/backend/superuser/module-stores` |

`cms.frontend` stand nach der Migration auf `cms.frontend.1`, dem PHP-Modul — dadurch lud die
Editier-UI nie. `migrate_from_php` bildet den Namen jetzt auf `cms.frontend.2` ab; weitere
Umbenennungen kommen in dieselbe Tabelle.

Beim ersten Rendern nennt qino selbst fehlende Module; diese Meldungen sind zuverlässiger als ein
reiner Namensabgleich. Die Auflösung folgt drei Regeln:

- Reine Umbenennungen stehen in `renamedModules.ts`, zum Beispiel `cms.backend.struct` →
  `cms.backend.cms.tree` und `cms.backend.mails` → `cms.backend.mail`.
- Module mit eigener Ausgabe oder eigenem Verhalten bleiben als Port im `cms-legacy`-Store, etwa
  `cms.cont.section3`, `cms.cont.cd.boxes` und die Slideshow der Schule.
- `cms.cont.phpfile` wird zu `cms.cont.ts`; die Dateien werden nach `data/cms.cont.ts/` verschoben,
  ihr PHP-Inhalt muss aber weiterhin von Hand nach TypeScript portiert werden.

Alte Backendmodule ohne qino-Pendant sind kein Grund, eine öffentliche Seite als fertig zu
betrachten. Ob sie für die Redaktion noch gebraucht werden, wird getrennt im Backend getestet.

## Spaltenumbenennungen: `migrate(app)` vor `app.init()`

Die Schema-Migration ist additiv und kann nur hinzufügen: eine im Schema umbenannte Spalte käme als
neue leere neben der vollen alten an, und im `patch`-Modus verschwindet die alte nie wieder.
`migrate_from_php` exportiert deshalb [`migrate(app)`](renameColumns.ts),
das die Anwendung selbst aufruft — `app.db` steht schon nach dem Konstruktor:

```ts
await migrate(app);
await app.init();
```

Erledigt heute `usr.email → username`, `firstname → given_name`, `lastname → family_name`,
`company → organization`, jeweils samt `_vers_`-Spiegel. Idempotent, und still auf einer
Datenbank, die es noch nicht gibt.

## Was `tools/prepare-db.sh` erledigt

Fünf Dinge, alle idempotent, alle vor dem ersten qino-Start nötig, weil `migrate_from_php` erst
nach der Schema-Migration und nach dem ersten Settings-Lesen läuft:

1. `qg_setting.w` löschen — wird gelesen, bevor irgendein Modul installiert ist.
2. `module.access` einen Default geben — die Werte braucht die Migration noch, nur die Constraint stört.
3. Jede weitere `NOT NULL`-Spalte ohne Default, die qino nicht kennt, nullable machen (Daten bleiben).
4. `datetime`-Spalten, die qino als Integer führt, auf Unix-Zeit umstellen. Sonst macht die
   Schema-Migration aus `2020-06-03 14:52:17` die Zahl `20200603145217` und läuft über.
5. MyISAM → InnoDB. qino installiert in einer Transaktion, die dort sonst wirkungslos verpufft.

## Nebenbefunde in qino

- **Datenverlust in `migrateLegacyPageSettings`** (behoben): die Funktion las die Seiten-Settings
  über `await app.settings.cms.pages[<id>]`. Das liefert den *Wert* des Astes, nicht seine Kinder —
  `JSON.stringify()` ergab `{}`. Geschrieben wurde also ein leeres Objekt, und **danach** wurden die
  Original-Zeilen aus `qg_setting` gelöscht. Sichtbar wurde es an der Navigation: `startPage=1` und
  `filter_visible=visible` von Cont 223 waren weg, die Nav blieb leer. Jetzt liest ein
  `settingTree()` den Teilbaum per SQL; alle 53 Seiten haben ihre Settings.

- `module/core/dbschema.json` führte `w` in `required` von `qg_setting`, ohne die Spalte zu
  definieren — dadurch wurde sie nie angelegt, stand aber als Pflichtfeld drin. Entfernt.
- Beim Schema-Abgleich: `Skip KEY page_url.url: string maxLength 255 is too long for a normal index`
  — der Index auf `page_url.url` wird übersprungen, die Legacy-Tabelle behält ihren eigenen.
- Beim ersten SPS-Lauf waren 46 der 48 Legacy-Tabellen **MyISAM**. `tools/prepare-db.sh` konvertiert sie
  inzwischen vor dem Start automatisch nach InnoDB, damit `installTx` tatsächlich atomar ist.
