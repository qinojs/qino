# migrate_from_php

Bringt eine bestehende PHP-CMS-Installation (Vanilla CMS, `v9`) auf qino. Der komplette Ablauf mit
sieben durchgespielten Sites steht in [MIGRATION.md](MIGRATION.md), die Verhaltensunterschiede in
[DIFFERENCES.md](DIFFERENCES.md), die Modul-Ports in [cms-legacy](../../cms-legacy/README.md).

Das PHP-Original liegt ausserhalb des Workspace unter `/var/www/workplace/v9` und wird nur gelesen.

## Zwei Reihenfolge-Regeln

Beides sind Eigenschaften der Startsequenz, keine Vorlieben — wer sie übergeht, verliert Daten
oder kommt gar nicht erst hoch.

**1. `migrate_from_php` läuft zu spät für alles, was den Start selbst berührt.** Sein `install()`
kommt nach der Schema-Migration, nach dem ersten Settings-Lesen und nach der ersten `module`-Zeile.
Alles, was diese drei anfassen, muss vorher in Form sein — deshalb gibt es
[tools/prepare-db.sh](tools/prepare-db.sh) mit fünf idempotenten Schritten: `qg_setting.w` löschen,
`module.access` einen Default geben, unbekannte `NOT NULL`-Spalten ohne Default nullable machen,
`datetime` → Unix-Zeit (sonst wird aus `2020-06-03 14:52:17` die Zahl `20200603145217`),
MyISAM → InnoDB (sonst verpufft die Installations-Transaktion).

Neue Reparaturen gehören nach `install()`, solange sie nach dem Start noch möglich sind. Nur was
den Start blockiert, kommt in `prepare-db.sh`. Das Skript kennt die qino-Seite über
[schemaColumns.ts](schemaColumns.ts) — dessen einziger Aufrufer; wer eins von beiden anfasst,
prüft das andere mit.

**2. `migrate(app)` muss vor `app.init()` laufen.** Die Schema-Migration ist additiv, sie kann nur
hinzufügen. Eine umbenannte Spalte käme sonst als neue leere neben der vollen alten an, und im
`patch`-Modus verschwindet die alte nie wieder. [renameColumns.ts](renameColumns.ts) exportiert
deshalb `migrate(app)`, das die Anwendung selbst aufruft — `app.db` steht schon nach dem
Konstruktor:

```ts
await migrate(app);
await app.init();
```

## Werkzeuge

`tools/` sind Wegwerf-Helfer für Testläufe, kein Produktionscode. Sie sind heute MySQL-only
(bash + python3 + `mysql`-CLI) und verlangen `MYSQL_PASS` in der Umgebung. Arbeitsordner ist
`migration-work/` im Monorepo-Root, überschreibbar mit `MIGRATE_WORK` — er muss innerhalb des
Repos liegen, weil das erzeugte Projekt `@qino/qino` nur als Deno-Workspace-Mitglied auflöst.

## Wo Module landen

Drei Regeln, in dieser Reihenfolge:

- Reine Umbenennung → [renamedModules.ts](renamedModules.ts) (`cms.backend.struct` → `cms.backend.cms.tree`).
- Eigene Ausgabe oder eigenes Verhalten → Port im `cms-legacy`-Store.
- `cms.cont.phpfile` → `cms.cont.ts`; die Dateien wandern mit, ihr PHP-Inhalt wird von Hand portiert.

Fehlende Module meldet qino beim ersten Rendern selbst — das ist zuverlässiger als ein
Namensabgleich.
