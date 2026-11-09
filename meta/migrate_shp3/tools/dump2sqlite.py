#!/usr/bin/env python3
"""MySQL dump of the PHP site → SQLite database for the qino migration test.

Throwaway helper like qino/meta/migrate_from_php/tools — it stands in for importing the dump into
MariaDB plus tools/prepare-db.sh, so the test needs no database server:

- every table, columns without NOT NULL (prepare-db step 3: qino decides later what is dead)
- qg_setting.w dropped (step 1), module.access defaults to 0 (step 2)
- datetime columns qino declares as integer → unix time (step 4), zero dates → NULL (step 4b)

usage: dump2sqlite.py <dump.sql | dump.sql.zip> <out.sqlite> <schema.json>
schema.json: output of qino/meta/migrate_from_php/schemaColumns.ts
"""
import io, json, re, sqlite3, sys, zipfile
from datetime import datetime, timezone

src, out, schema_path = sys.argv[1:4]
schema = json.load(open(schema_path))
INT_COLS = {(t, c) for t, cols in schema.items() for c, typ in cols.items() if typ == "integer"}


def open_dump(path):
    if path.endswith(".zip"):
        z = zipfile.ZipFile(path)
        return io.TextIOWrapper(z.open(z.namelist()[0]), encoding="utf-8", errors="replace")
    return open(path, encoding="utf-8", errors="replace")


def sqlite_type(mysql):
    m = mysql.lower()
    if re.match(r"(tiny|small|medium|big)?int", m): return "INTEGER"
    if re.match(r"(float|double|decimal|numeric|real)", m): return "REAL"
    if re.match(r"(blob|longblob|mediumblob|tinyblob|binary|varbinary)", m): return "BLOB"
    return "TEXT"


def unix(value):
    if value is None or value.startswith("0000") or "-00" in value[:10]: return 0
    fmt = "%Y-%m-%d %H:%M:%S" if " " in value else "%Y-%m-%d"
    # the PHP server ran on local time, as MariaDB's UNIX_TIMESTAMP() assumes
    return int(datetime.strptime(value[:19], fmt).timestamp())


def parse_values(s, i):
    """Tuples of an INSERT … VALUES list, MySQL escaping."""
    rows, n = [], len(s)
    while i < n:
        while i < n and s[i] in " ,\n": i += 1
        if i >= n or s[i] != "(": break
        i += 1
        row = []
        while True:
            c = s[i]
            if c == "'":
                i += 1
                buf = []
                while True:
                    c = s[i]
                    if c == "\\":
                        nxt = s[i + 1]
                        buf.append({"n": "\n", "r": "\r", "t": "\t", "0": "\0", "Z": "\x1a"}.get(nxt, nxt))
                        i += 2
                    elif c == "'":
                        if s[i + 1] == "'": buf.append("'"); i += 2
                        else: i += 1; break
                    else:
                        j = i
                        while s[j] not in "\\'": j += 1
                        buf.append(s[i:j]); i = j
                row.append("".join(buf))
            else:
                j = i
                while s[j] not in ",)": j += 1
                tok = s[i:j].strip(); i = j
                if tok == "NULL": row.append(None)
                elif re.fullmatch(r"-?\d+", tok): row.append(int(tok))
                else:
                    try: row.append(float(tok))
                    except ValueError: row.append(tok)
            if s[i] == ",": i += 1; continue
            i += 1  # ")"
            break
        rows.append(row)
    return rows


db = sqlite3.connect(out)
db.execute("PRAGMA journal_mode = OFF")
db.execute("PRAGMA synchronous = OFF")
tables = {}  # name → [(column, mysql type)]
dropped = {}  # name → indexes of dump columns left out
create, name = None, None
counts = {}

for line in open_dump(src):
    if create is not None:
        create.append(line)
        if line.startswith(")"):
            cols, pk, defs, skip, pos = [], [], [], [], 0
            for l in create[1:-1]:
                l = l.strip().rstrip(",")
                m = re.match(r"`([^`]+)` (\S+(?: unsigned)?)(.*)", l)
                if m:
                    col, typ, rest = m.groups()
                    pos += 1
                    if (name, col) in (("qg_setting", "w"), ("page_file", "draft")):
                        skip.append(pos - 1)
                        continue
                    cols.append((col, typ))
                    d = re.search(r"DEFAULT ('(?:[^']|'')*'|-?[\d.]+|NULL)", rest)
                    default = d.group(1) if d else None
                    if name == "module" and col == "access": default = "0"
                    is_date = typ.lower() in ("datetime", "date", "timestamp")
                    if is_date and (name, col) in INT_COLS: default = "0"
                    elif is_date: default = "NULL"
                    auto = "AUTO_INCREMENT" in rest
                    defs.append([col, "INTEGER" if is_date and (name, col) in INT_COLS else sqlite_type(typ), default, auto])
                elif l.startswith("PRIMARY KEY"):
                    pk = re.findall(r"`([^`]+)`", l)
                    if name == "page_file": pk = [c for c in pk if c != "draft"]
            parts = []
            for col, typ, default, auto in defs:
                p = f'"{col}" {typ}'
                if auto and pk == [col]: p += " PRIMARY KEY AUTOINCREMENT"
                elif default is not None: p += f" DEFAULT {default}"
                parts.append(p)
            if pk and not any(d[3] and pk == [d[0]] for d in defs):
                parts.append("PRIMARY KEY (" + ", ".join(f'"{c}"' for c in pk) + ")")
            db.execute(f'DROP TABLE IF EXISTS "{name}"')
            db.execute(f'CREATE TABLE "{name}" ({", ".join(parts)})')
            tables[name] = cols
            dropped[name] = skip
            create = None
        continue
    m = re.match(r"CREATE TABLE `([^`]+)`", line)
    if m:
        name, create = m.group(1), [line]
        continue
    m = re.match(r"INSERT INTO `([^`]+)` VALUES ", line)
    if not m: continue
    table = m.group(1)
    cols = tables[table]
    names = [c for c, _ in cols]
    rows = parse_values(line, m.end())
    dates = [i for i, (c, t) in enumerate(cols) if t.lower() in ("datetime", "date", "timestamp")]
    out_rows = []
    for r in rows:
        if dropped[table]: r = [v for i, v in enumerate(r) if i not in dropped[table]]
        for i in dates:
            v = r[i]
            if (table, names[i]) in INT_COLS: r[i] = unix(v)
            elif isinstance(v, str) and (v.startswith("0000") or "-00" in v[:10]): r[i] = None
        out_rows.append(r)
    ph = ", ".join("?" * len(cols))
    db.executemany(f'INSERT INTO "{table}" ({", ".join(chr(34) + c + chr(34) for c in names)}) VALUES ({ph})', out_rows)
    counts[table] = counts.get(table, 0) + len(out_rows)

db.commit()
print(f"{len(tables)} tables, {sum(counts.values())} rows")
