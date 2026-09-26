# Plan für ai1.embed

## Ausgangslage

Die aktuelle Lösung ist für große, gefilterte Suchen unbefriedigend. Die Vektoren stehen
als JSON in `ai1_embed_entry`; ein separater `sqlite-vec`-Cache sucht exakt und liefert
begrenzte Treffer. Bedingungen aus anderen Tabellen, etwa `chat.user_id` oder
`product.category_id`, können erst danach angewandt werden. So können passende Treffer
fehlen. Der Cache wird bei abweichender Revision aus allen Einträgen neu aufgebaut.

Ziel sind **Hunderte Millionen Embedding-Einträge**. Dafür müssen Collection, fachliche
Filter, Distanz und `LIMIT` gemeinsam in der Datenbank verarbeitet werden. Ein Datensatz
kann mehrere Embeddings besitzen: verschiedene Felder, Textabschnitte und Modelle.
Bild-Embeddings sollen weiterhin über den MD5 des Inhalts eindeutig sein.

## Gemeinsame Suchabfrage als Ziel

Die folgende Abfrage zeigt die Variante mit einer Tabelle für `ai_chat_history`. `field`
bezeichnet das eingebettete Feld; falls ein Feld aufgeteilt wird, braucht jeder Abschnitt
zusätzlich eine eigene `chunk`-Nummer. Diese Trennung ist ein **Vorschlag** für das neue
Schema: Das bisherige `part` vermischt beides und führt zu Abfragen mit `LIKE 'text:%'`.

```sql
SELECT h.id, h.chat_id, h.text,
       VEC_DISTANCE_COSINE(e.embedding, VEC_FromText(?)) AS distance
FROM ai_chat AS c
JOIN ai_chat_history AS h ON h.chat_id = c.id
JOIN ai_chat_history_embedding AS e
  ON e.history_id = h.id AND e.collection_id = ? AND e.field = 'text'
WHERE c.user_id = ? AND c.id = ?
ORDER BY distance
LIMIT 10;
```

Die Bedingung auf `user_id` muss vor `LIMIT` gelten. Wenn eine Nachricht mehrere
Textabschnitte hat, liefert diese Abfrage zunächst **Abschnitte**: Für die zehn besten
*Nachrichten* ist die kleinste Distanz je `h.id` vor dem abschließenden `LIMIT` zu
bestimmen. Das dürfen Helfer nicht stillschweigend mit einem Trefferlimit davor lösen.

## Variante A: gemeinsame Embedding-Tabelle für alle Quelltabellen

Logische Einträge enthalten `table_name`, `row_id`, `field`, gegebenenfalls `chunk` und
einen Vektor. Eine Collection wählt Modell und Dimension. Weil MariaDB `VECTOR(N)` mit
fester Dimension verwendet, wäre die physische Vektortabelle mindestens je Collection
getrennt; sie wird automatisch aus der Collection abgeleitet. Quellreferenz und Vektor
können in dieser Tabelle zusammenliegen. Eine zusätzliche Trennung in
`ai1_embed_entry` und `ai1_embed_vector_1` kostet einen Join und braucht einen eigenen
Grund.

```sql
SELECT h.id, h.chat_id, h.text,
       VEC_DISTANCE_COSINE(e.embedding, VEC_FromText(?)) AS distance
FROM ai_chat AS c
JOIN ai_chat_history AS h ON h.chat_id = c.id
JOIN ai1_embed_vector_1 AS e
  ON e.table_name = 'ai_chat_history'
 AND e.row_id = CAST(h.id AS CHAR)
 AND e.field = 'text'
WHERE c.user_id = ? AND c.id = ?
ORDER BY distance
LIMIT 10;
```

`ai1_embed_vector_1` ist hier nur ein Beispielname für die automatisch gewählte
Collection-Tabelle, kein festgelegtes Schema. Ein zusammengesetzter relationaler Index
auf Quelltabelle, Zeilen-ID und Feld ist für diesen Join nötig. Der Cast liegt auf
`h.id`; `e.row_id` bleibt unverändert. Der konkrete Indexpfad ist mit `EXPLAIN` zu
prüfen. Eine direkte Gegenüberstellung von numerischer ID und String-Spalte ist in
MariaDB ungünstig, weil deren Index dann nicht benutzt werden kann.

**Stärken:** Eine Speicherform und dieselben Helfer für beliebige Quelltabellen;
Collections und neue Quellen brauchen keine fachliche Embedding-Tabelle. Eine MD5-Referenz
für Bildinhalte passt neben numerischen und zusammengesetzten IDs.

**Kosten:** String-IDs und Quelltabellen-Namen vergrößern Schlüssel und Indizes;
datenbankseitige Fremdschlüssel zu allen unterschiedlichen Quelltabellen sind nicht
möglich. Ein globaler ANN-Index einer Collection enthält auch Embeddings anderer
Quellen. Sehr selektive Filter wie ein einzelner Chat profitieren dann vor allem vom
relationalen Filter und anschließender exakter Distanzberechnung.

## Variante B: eigene Embedding-Tabelle je Quelltabelle

`ai_chat_history_embedding` enthält eine typgleiche `history_id`, `collection_id`,
`field`, gegebenenfalls `chunk` und den Vektor. Eine passende Eindeutigkeit umfasst
Quell-ID, Collection, Feld und Abschnitt. Weitere Quellen erhalten entsprechende
Tabellen und Indizes. Unterschiedliche Dimensionen brauchen auch hier getrennte
physische Vektorspalten oder Tabellen; ein einziges `VECTOR(N)` reicht dafür nicht.

**Stärken:** Direkter Join über gleich typisierte IDs und mögliche Fremdschlüssel;
kleinere, quellspezifische Indizes und kein `table_name`-Filter. Schema und Abfrage
des Fachmoduls bleiben zusammen.

**Kosten:** Jede neue Quelle benötigt Tabellenschema und Pflege. Die generischen Helfer
müssen diese Tabellen nutzen können, ohne sie im Core einzeln zu kennen. Für `file`
reicht eine `file_id` als Bildidentität nicht: Gleicher MD5 soll denselben Bildvektor
nutzen können, auch wenn mehrere Dateizeilen darauf verweisen.

| Frage | Gemeinsam, je Collection | Je Quelltabelle |
| --- | --- | --- |
| Neue Quelle | Kein neues Schema | Eigene Embedding-Tabelle |
| Join zur Quellzeile | Generische String-ID, ggf. Cast | Typgleiche ID |
| Modellwechsel | Neue Collection-Tabelle | Collection plus Ablage für ihre Dimension |
| Mehrere Felder/Abschnitte | `field` und `chunk` | `field` und `chunk` |
| Sehr großer ANN-Index | Quellen teilen sich den Index | Mindestens nach Quelle getrennt |
| Fachliche Filter | Join zur Quelltabelle | Join zur Quelltabelle |

## Skalierung und Entscheidungsmaßstab

Bei 100 Millionen Vektoren mit 1024 Dimensionen benötigen schon die rohen
32-Bit-Werte rund **410 GB**; ANN-Indizes, relationale Indizes, Zeilen und mehrere
Collections kommen hinzu. Ein volles Neubauen eines flüchtigen Caches und eine exakte
Distanzberechnung über alle Einträge sind deshalb keine Zielarchitektur.

Für einen kleinen, durch `chat_id` eingegrenzten Kandidatensatz ist ein relationaler
Index mit anschließender exakter Distanzberechnung sinnvoll. Für breite Suchräume wird
ein ANN-Index gebraucht. Ein ANN-Index macht beliebige nachträgliche Joins und
Benutzerfilter aber nicht automatisch schnell oder vollständig; ein `LIMIT` vor dem
fachlichen Filter ist falsch. `STRAIGHT_JOIN` erzwingt einen Filter-zuerst-Pfad und
soll nur verwendet werden, wenn dieser Pfad tatsächlich der passende ist.

Vor einer Festlegung müssen beide Varianten mit mindestens 100 Millionen Einträgen
auf der vorgesehenen Datenbankversion geprüft werden: enger Chat-Filter, alle Chats
eines Benutzers, breite Suche, mehrere Collections sowie Schreib- und Löschlast.
Zu messen sind `EXPLAIN`-Pläne, Laufzeiten einschließlich p95, Trefferqualität
gegenüber exakter Suche, Speicherbedarf und Zeit für Indexaufbau. Erst danach lässt
sich eine Variante als skalierbar bezeichnen.
Bei Hunderten Millionen Einträgen kann zusätzlich eine Aufteilung in mehrere physische
Suchräume nötig sein; deren Nutzen und Unterstützung durch den gewählten Dialekt sind
gesondert nachzuweisen. **Keine der beiden Tabellenformen allein garantiert diese
Größenordnung.**

Die native MariaDB-Vektorsuche setzt MariaDB 11.7 oder neuer voraus. Qinos andere
Datenbankdialekte brauchen eigene Suchimplementierungen mit derselben fachlichen
Semantik. Die heutige exakte `sqlite-vec`-Suche ist kein Leistungsnachweis für
Hunderte Millionen Einträge; PostgreSQL kann mit pgvector geprüft werden.

Die öffentliche API soll nur wiederkehrende Arbeit übernehmen: Collection wählen,
Text oder Bild einbetten, Einträge pflegen und einen für SQL-Abfragen nutzbaren
Suchvektor bereitstellen. Fachliche Joins und Zugriffsfilter bleiben beim aufrufenden
Modul. Eine konkrete API und die physische Tabellenform werden erst nach den
Abfrage- und Skalierungstests festgelegt.

Grundlagen: [MariaDB-Vektortabellen](https://mariadb.com/docs/server/reference/sql-structure/vectors/create-table-with-vectors),
[MariaDB-Typumwandlung](https://mariadb.com/docs/server/reference/sql-functions/string-functions/type-conversion),
[pgvector: Filter und ANN](https://github.com/pgvector/pgvector#filtering).
