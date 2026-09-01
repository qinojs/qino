#!/bin/bash
# Sets up one project from the Plesk backup: PHP original next to a qino instance on a copy of its
# database, so both can be compared. Everything it does is described in MIGRATION.md.
#
# usage: ./new-project.sh <site-dir-in-backup> <db> <short-name> [port]
#   ./new-project.sh swisspremiumservices.com.vanilla-cms.org sps sps 8091
set -euo pipefail
SITE=${1:?site directory inside the backup missing}
DB=${2:?database name missing}
SHORT=${3:?short name missing}
PORT=${4:-8091}
[[ $SITE =~ ^[A-Za-z0-9][A-Za-z0-9._-]*(/[A-Za-z0-9][A-Za-z0-9._-]*)*$ ]] || { echo "invalid site directory: $SITE" >&2; exit 2; }
[[ $DB =~ ^[A-Za-z0-9_]+$ ]] || { echo "invalid database name: $DB" >&2; exit 2; }
[[ $SHORT =~ ^[A-Za-z0-9_-]+$ ]] || { echo "invalid short name: $SHORT" >&2; exit 2; }
[[ $PORT =~ ^[0-9]+$ ]] || { echo "invalid port: $PORT" >&2; exit 2; }

HERE=$(cd "$(dirname "$0")" && pwd)
QINO=$(cd "$HERE/../../.." && pwd)             # the qino package
ROOT=$(cd "$QINO/.." && pwd)                   # monorepo root, holds the deno workspace
# Scratch dir for backup, dumps and generated projects. Must sit inside the monorepo: the
# generated project only resolves @qino/qino as a member of $ROOT/deno.json.
WORK=${MIGRATE_WORK:-$ROOT/migration-work}
case $WORK in "$ROOT"/*) ;; *) echo "MIGRATE_WORK must be inside $ROOT" >&2; exit 2;; esac
REL=${WORK#"$ROOT"/}
mkdir -p "$WORK"
TARS=("$WORK"/backup_*.tar)
TAR=${TARS[0]}
[ -f "$TAR" ] || { echo "no backup_*.tar found in $WORK" >&2; exit 1; }
WEB=/var/www/workplace/$SHORT          # apache serves /var/www/workplace
APP=$WORK/qino-$SHORT
MYSQL_USER=${MYSQL_USER:-admin}; MYSQL_PASS=${MYSQL_PASS:?mysql password missing — export MYSQL_PASS}
sql() { mysql -u"$MYSQL_USER" -p"$MYSQL_PASS" ${1:+"$@"} 2>/dev/null; }

echo "== $SHORT ($SITE, db $DB)"

# ── site files ───────────────────────────────────────────────────────────────────────────────
if [ ! -d "$WEB" ]; then
  echo "-- entpacke Site (ein Durchgang durch das 3.4-GB-Archiv, dauert)"
  mkdir -p "$WORK/sites-data"
  extracted=1
  tar xOf "$TAR" --wildcards 'backup_user-data_*.tzst' | zstd -dc |
    tar x -C "$WORK/sites-data" --wildcards "*$SITE*" || extracted=0
  if [ "$extracted" = 0 ] || [ ! -d "$WORK/sites-data/$SITE" ]; then
    rm -rf -- "$WORK/sites-data/$SITE"
    find "$WORK/sites-data" -depth -type d -empty -delete
    echo "im Archiv gibt es kein Verzeichnis '$SITE'." >&2
    echo "Sites des Abos vanilla-cms.org heissen '<domain>.vanilla-cms.org' (backup_info_*.xml:" >&2
    echo "<site … parent-domain-name=\"vanilla-cms.org\">). Sites mit eigenem Abo liegen dagegen" >&2
    echo "unter '<domain>/httpdocs' — dort ist der Pfad das Argument, nicht der Site-Name." >&2
    exit 1
  fi
  mv "$WORK/sites-data/$SITE" "$WEB"
  find "$WORK/sites-data" -depth -type d -empty -delete
  # the backup carries the files as the calling user; apache runs as www-data
  chgrp -R www-data "$WEB"; chmod -R g+rX "$WEB"; chmod -R g+w "$WEB/cache" "$WEB/qg"
  find "$WEB" -type d -exec chmod g+s {} +
fi

# ── database: one for PHP, one for qino ──────────────────────────────────────────────────────
DUMP=$WORK/$DB.sql
if [ ! -f "$DUMP" ]; then
  tar xf "$TAR" "databases/${DB}_1" -C "$WORK" 2>/dev/null || tar xf "$TAR" "databases/${DB}_1"
  zstd -dc "$WORK/databases/${DB}_1"/backup_sqldump_*.tzst | tar xO > "$DUMP"
fi
# importing again would throw away a migration that already ran — the reset in MIGRATION.md does
# that deliberately, this script only ever sets up what is missing.
for target in "$DB" "${DB}_qino"; do
  if [ "$(sql -N -e "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='$target'")" = 0 ]; then
    sql -e "CREATE DATABASE \`$target\` CHARACTER SET utf8mb4"
    sql "$target" < "$DUMP"
    if [ "$target" = "${DB}_qino" ]; then "$HERE/prepare-db.sh" "${DB}_qino"; fi
  fi
done

# ── PHP original: local credentials, plain http ──────────────────────────────────────────────
sed -i "s/define('QG_HTTPS', *true)/define('QG_HTTPS', false)/" "$WEB/index.php"
if grep -q "define('qg_dbuser'" "$WEB/index.php"; then
  sed -i "s/define('qg_dbuser'.*/define('qg_dbuser', '$MYSQL_USER');/" "$WEB/index.php"
else
  sed -i "s/define('qg_dbpass'/define('qg_dbuser', '$MYSQL_USER');\ndefine('qg_dbpass'/" "$WEB/index.php"
fi
sed -i "s/define('qg_dbpass'.*/define('qg_dbpass', '$MYSQL_PASS');/" "$WEB/index.php"

# ── qino instance ────────────────────────────────────────────────────────────────────────────
mkdir -p "$APP/site-templates"
[ -d "$APP/qg" ] || [ -d "$APP/data" ] || cp -a "$WEB/qg" "$APP/qg" # migrate_from_php moves qg/ → data/
[ -f "$APP/deno.json" ] || cp "$HERE/deno.template.json" "$APP/deno.json"

# server.ts holds the modules this site really uses: every page.module, under the name the
# migration gives it, sorted by where that module lives. What is left over needs a port.
if [ ! -f "$APP/server.ts" ]; then
  sql -N -e "SELECT DISTINCT module FROM \`${DB}_qino\`.page WHERE module <> ''" |
  QINO="$QINO" DBURL="mysql://$MYSQL_USER:$MYSQL_PASS@localhost/${DB}_qino" python3 -c '
import os, re, sys
qino = os.environ["QINO"]
renames = dict(re.findall(r"\"([^\"]+)\": \"([^\"]+)\"", open(qino + "/meta/migrate_from_php/renamedModules.ts").read()))
# already in the template, they must not appear twice
std = {"core", "cms", "cms.text", "cms.image2", "cms.cont.flexible", "cms.cont.text",
       "cms.cont.image2", "cms.frontend.2", "cms.filebrowser", "fileEditor"}
fixed, legacy, missing = set(std), {"cms.legacy.c1"}, set()
def needs(mod):
    """what the module declares it needs, so the list stays startable"""
    for store, bucket in ((f"{qino}/module", std), (f"{qino}/cms-legacy", legacy)):
        path = f"{store}/{mod}/plugin.ts"
        if not os.path.isfile(path): continue
        if mod in bucket: return True
        bucket.add(mod)
        declared = re.search(r"export const needs = \[([^\]]*)\]", open(path).read())
        for need in re.findall(r"\"([^\"]+)\"", declared.group(1) if declared else ""): needs(need)
        return True
for line in sys.stdin:
    mod = renames.get(line.strip(), line.strip())
    if mod and not needs(mod): missing.add(mod)
def block(names, indent):
    out, line = [], ""
    for name in sorted(names):
        if len(line) + len(name) > 100: out.append(line); line = ""
        line += f"{indent}\"{name}\"," if not line else f" \"{name}\","
    if line: out.append(line)
    return "\n".join(out)
tpl = open(sys.argv[1]).read()
tpl = tpl.replace("__STD__", block(std - fixed, "    ")).replace("__LEGACY__", block(legacy - {"cms.legacy.c1"}, "    "))
tpl = tpl.replace("__MISSING__", "// no qino module yet, the pages stay empty until these are ported:\n" +
    "".join(f"// {m}\n" for m in sorted(missing)) if missing else "")
for k, v in [("__SITE__", sys.argv[2]), ("__DB__", sys.argv[3]), ("__SHORT__", sys.argv[4]),
             ("__PORT__", sys.argv[5]), ("__ENV__", "QINO_" + sys.argv[4].upper() + "_URL"),
             ("__DBURL__", os.environ["DBURL"])]:
    tpl = tpl.replace(k, v)
open(sys.argv[6], "w").write(tpl)
print("\n".join("  fehlt noch: " + m for m in sorted(missing)))
' "$HERE/server.template.ts" "$SITE" "$DB" "$SHORT" "$PORT" "$APP/server.ts"
fi

grep -q "\"./$REL/qino-$SHORT\"" "$ROOT/deno.json" ||
  sed -i "s#^\(\s*\)\"./qino\",#\1\"./qino\",\n\1\"./$REL/qino-$SHORT\",#" "$ROOT/deno.json"

# A qg/<module>/index.php is only the site's template when the module includes it — the installer
# also copies custom/ folders that no module ever reads.
templates=$(for f in "$WEB"/qg/*/index.php; do
  [ -f "$f" ] || continue
  mod=$(basename "$(dirname "$f")")
  grep -q "qg/'\.\$module\|qg/'\.\$Cont->vs\['module'\]\|customTemplatePath" "$WEB/m/$mod/index.php" 2>/dev/null && echo "  $f"
done || true)

cat <<TXT

fertig.
  PHP    http://localhost/$SHORT/?cmspid=2
  qino   cd $APP && deno task start   → http://localhost:$PORT/

Danach von Hand: die eigenen Templates der Site portieren
${templates:-  (keine)}
  → $APP/site-templates/<modul>/index.ts
Vor dem ersten Start nach qg/ kopieren:
  cp -a $APP/site-templates/. $APP/qg/
und ./compare.sh $DB $PORT $SHORT für den Abgleich.
TXT
