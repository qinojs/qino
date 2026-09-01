#!/bin/bash
# Requests every page of a migrated site from the PHP original and from qino and reports where they
# differ. Byte counts alone are noisy — qino renders leaner markup — so the comparison is on the
# text content: what a visitor reads has to survive the migration.
#
# usage: ./compare.sh <db> <qino-port> <short-name> [lang] [php-base-url]
set -euo pipefail
DB=${1:?database name missing}
PORT=${2:?qino port missing}
SHORT=${3:?short name missing}
LANG_=${4:-en}
PHP_BASE=${5:-http://localhost/$SHORT}
QINO_BASE=${QINO_BASE:-http://localhost:$PORT}
[[ $DB =~ ^[A-Za-z0-9_]+$ ]] || { echo "invalid database name: $DB" >&2; exit 2; }
[[ $LANG_ =~ ^[A-Za-z0-9_-]+$ ]] || { echo "invalid language: $LANG_" >&2; exit 2; }
PHP_BASE=${PHP_BASE%/}
QINO_BASE=${QINO_BASE%/}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

mysql -u"${MYSQL_USER:-admin}" -p"${MYSQL_PASS:?mysql password missing — export MYSQL_PASS}" -N -e "
  SELECT u.url FROM ${DB}_qino.page_url u
  JOIN ${DB}_qino.page p ON p.id = u.page_id
  WHERE u.lang = '$LANG_' AND u.url <> '' AND p.type = 'p' AND COALESCE(p.access, 1) > 0
  ORDER BY p.id" 2>/dev/null |
while read -r url; do
  # page_url.url already carries the language prefix
  php_status=$(curl -sL --max-time 30 -o "$TMP/php" -w '%{http_code}' "$PHP_BASE/$url")
  qino_status=$(curl -sL --max-time 30 -o "$TMP/qino" -w '%{http_code}' "$QINO_BASE/$url")
  read -r equal score php_len qino_len php_debug qino_debug < <(python3 -c '
from difflib import SequenceMatcher
from html.parser import HTMLParser
import re
import sys

class VisibleText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.hidden = 0
        self.parts = []
    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "template"}: self.hidden += 1
    def handle_endtag(self, tag):
        if tag in {"script", "style", "template"}: self.hidden = max(0, self.hidden - 1)
    def handle_data(self, data):
        if not self.hidden: self.parts.append(data)

def text(path):
    raw = open(path, encoding="utf-8", errors="replace").read()
    # PHP development mode wraps notices and deprecations in links to its source editor. They are
    # diagnostics rather than page content: count and report them, but do not let them dominate the
    # visible-text score (one old strftime call can otherwise turn a near match into a 10% result).
    debug = re.compile(r"<a\b[^>]*href=[\"\x27][^\"\x27]*/editor\?file=.*?</a>", re.I | re.S)
    warnings = len(debug.findall(raw))
    raw = debug.sub("", raw)
    parser = VisibleText()
    parser.feed(raw)
    return " ".join("".join(parser.parts).split()), warnings

(a, aw), (b, bw) = map(text, sys.argv[1:])
print(int(a == b), round(SequenceMatcher(None, a, b, autojunk=False).ratio() * 100), len(a), len(b), aw, bw)
' "$TMP/php" "$TMP/qino")
  debug_note=""
  if [ "$php_debug" != 0 ] || [ "$qino_debug" != 0 ]; then
    debug_note=", debug php=$php_debug/qino=$qino_debug"
  fi
  if [ "$equal" = 1 ] && [ "$php_status" = "$qino_status" ]; then
    printf 'ok    %-40s http %s, %d zeichen%s\n' "$url" "$php_status" "$php_len" "$debug_note"
  else
    printf 'DIFF  %-40s %3d%%, php %s/%d, qino %s/%d%s\n' \
      "$url" "$score" "$php_status" "$php_len" "$qino_status" "$qino_len" "$debug_note"
  fi
done
