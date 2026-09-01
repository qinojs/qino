#!/bin/bash
# Prepares a legacy PHP-CMS database for the first qino start. Idempotent.
#
# qino repairs most legacy leftovers itself, in migrate_from_php — but its install() runs after the
# first settings read and after the first module row is written. Whatever those two touch has to be
# in shape beforehand, and that is what this script does.
#
# usage: ./prepare-db.sh <database> [mysql-user] [mysql-password]
set -euo pipefail
DB=${1:?database name missing}
MYSQL_USER=${2:-${MYSQL_USER:-admin}}
MYSQL_PASS=${3:-${MYSQL_PASS:?mysql password missing — pass it as $3 or export MYSQL_PASS}}
QINO=${QINO:-$(cd "$(dirname "$0")/../../.." && pwd)}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
sql() { mysql -u"$MYSQL_USER" -p"$MYSQL_PASS" ${1:+"$@"} 2>/dev/null; }

echo "== $DB"
# --allow-env: the plugins pull in npm packages that sniff the environment for colour support
deno run --allow-read --allow-env "$QINO/meta/migrate_from_php/schemaColumns.ts" "$QINO" > "$TMP/schema.json"

# Very old CMS versions used plural page_texts and online/offline column names. Renaming them before
# qino installs the CMS schema preserves the data in place instead of creating new empty columns or
# a second empty page_text table. All checks are idempotent for interrupted setup runs.
if sql -N -e "SELECT 1 FROM information_schema.tables
     WHERE table_schema='$DB' AND table_name='page_texts'
       AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='$DB' AND table_name='page_text')" | grep -q 1; then
  sql "$DB" -e "RENAME TABLE page_texts TO page_text"
  echo "   page_texts → page_text"
fi
for pair in "online online_start" "offline online_end"; do
  read -r old current <<< "$pair"
  if sql -N -e "SELECT 1 FROM information_schema.columns
       WHERE table_schema='$DB' AND table_name='page' AND column_name='$old'
         AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='$DB' AND table_name='page' AND column_name='$current')" | grep -q 1; then
    sql "$DB" -e "ALTER TABLE page CHANGE COLUMN \`$old\` \`$current\` INT(10) NULL"
    echo "   page.$old → $current"
  fi
done

# draft was part of page_file's primary key even though released sites only contain draft=0. qino
# has a separate versions store and inserts without this column, so the obsolete key part must go.
if sql -N -e "SELECT 1 FROM information_schema.columns
     WHERE table_schema='$DB' AND table_name='page_file' AND column_name='draft'" | grep -q 1; then
  if [ "$(sql "$DB" -N -e "SELECT COUNT(*) FROM page_file WHERE draft <> 0")" != 0 ]; then
    echo "page_file contains legacy draft rows; migrate them before removing page_file.draft" >&2
    exit 1
  fi
  sql "$DB" -e "ALTER TABLE page_file DROP PRIMARY KEY, DROP COLUMN draft, ADD PRIMARY KEY (page_id, name)"
  echo "   page_file.draft samt altem Primärschlüssel gelöscht"
fi

# 1. qg_setting.w — read before any module installs, and qino never writes it. Nothing reads it
#    either, so it goes for good.
if sql -N -e "SELECT 1 FROM information_schema.columns
     WHERE table_schema='$DB' AND table_name='qg_setting' AND column_name='w'" | grep -q 1; then
  sql "$DB" -e "ALTER TABLE qg_setting DROP COLUMN w"
  echo "   qg_setting.w gelöscht"
fi

# 2. module.access — carries the access levels migrate_from_php still needs, so it only loses the
#    constraint here; the migration migrates the values and drops the column afterwards.
if sql -N -e "SELECT 1 FROM information_schema.columns
     WHERE table_schema='$DB' AND table_name='module' AND column_name='access' AND column_default IS NULL" | grep -q 1; then
  sql "$DB" -e "ALTER TABLE module MODIFY COLUMN access TINYINT(1) NOT NULL DEFAULT 0"
  echo "   module.access hat jetzt einen Default"
fi

# 3. every other NOT NULL column without a default that qino does not know. Data stays, only the
#    constraint goes — migrate_from_php decides afterwards what is dead and what is kept.
sql -N -e "SELECT table_name, column_name, column_type FROM information_schema.columns
     WHERE table_schema='$DB' AND is_nullable='NO' AND column_default IS NULL
       AND extra NOT LIKE '%auto_increment%'" |
SCHEMA="$TMP/schema.json" python3 -c '
import json, os, sys
schema = {tbl: set(cols) for tbl, cols in json.load(open(os.environ["SCHEMA"])).items()}
for line in sys.stdin:
    parts = line.rstrip("\n").split("\t")
    if len(parts) < 3: continue
    tbl, col, typ = parts
    if tbl not in schema or col in schema[tbl]: continue   # qino knows it — leave it alone
    print(f"ALTER TABLE `{tbl}` MODIFY COLUMN `{col}` {typ} NULL;")
' > "$TMP/prepare.sql"

if [ -s "$TMP/prepare.sql" ]; then
  sed 's/^/   /' "$TMP/prepare.sql"
  sql "$DB" < "$TMP/prepare.sql"
fi

# 4. Columns qino declares as integer (unix time) that the PHP schema kept as datetime. qino's
#    schema migration would MODIFY them to INT, turning "2020-06-03 14:52:17" into 20200603145217
#    and overflowing. Convert the values first; the detour through varchar is what lets
#    UNIX_TIMESTAMP() write into the same column.
sql -N -e "SELECT table_name, column_name, data_type FROM information_schema.columns
     WHERE table_schema='$DB' AND data_type IN ('datetime','timestamp','date')" |
SCHEMA="$TMP/schema.json" python3 -c '
import json, os, sys
want = {(tbl, col) for tbl, cols in json.load(open(os.environ["SCHEMA"])).items() for col, typ in cols.items() if typ == "integer"}
for line in sys.stdin:
    parts = line.rstrip("\n").split("\t")
    if len(parts) < 3: continue
    tbl, col, _ = parts
    if (tbl, col) not in want: continue
    print(f"ALTER TABLE `{tbl}` MODIFY COLUMN `{col}` VARCHAR(30) NULL;")
    print(f"UPDATE `{tbl}` SET `{col}` = COALESCE(UNIX_TIMESTAMP(`{col}`), 0);")
    print(f"ALTER TABLE `{tbl}` MODIFY COLUMN `{col}` INT NOT NULL DEFAULT 0;")
' > "$TMP/time.sql"

if [ -s "$TMP/time.sql" ]; then
  grep -c UPDATE "$TMP/time.sql" | sed 's/^/   /;s/$/ datetime-Spalten → unix-Zeit/'
  sql "$DB" < "$TMP/time.sql"
fi

# 5. MyISAM ignores transactions, and qino installs inside one — a failed install would leave a
#    half-migrated site behind.
sql -N -e "SELECT table_name FROM information_schema.tables
     WHERE table_schema='$DB' AND engine='MyISAM'" > "$TMP/myisam.txt"
COUNT=$(wc -l < "$TMP/myisam.txt")
if [ "$COUNT" -gt 0 ]; then
  echo "   $COUNT MyISAM-Tabellen → InnoDB"
  while read -r t; do sql "$DB" -e "ALTER TABLE \`$t\` ENGINE=InnoDB"; done < "$TMP/myisam.txt"
fi

echo "   bereit"
