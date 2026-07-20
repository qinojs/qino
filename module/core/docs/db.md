# Database access

Three layers, from low to high:

| Layer | What it is | Use for |
|---|---|---|
| `` sql`…` `` fragment | dialect-neutral AST (from item.js) | building reusable/composed SQL pieces |
| `db.query` / `row` / `col` / … | render a fragment and run it, returning rows | one-off **reads** |
| `db.exec` | render a fragment and run it, returning an `ExecResult` | one-off **writes** (INSERT/UPDATE/DELETE) |
| `db.table(name)` helpers | schema-aware `insert`/`update`/`ensure`/`delete`/`select` | normal row CRUD (the safe write path) |

Reserve `query` (and `row`/`col`/`one`/`indexCol`) for reads; run writes through `exec`, which
returns `affectedRows`/`insertId` and carries dialect write-quirks. Both take the same
`` `…` `` template.

The driver (`DbDriver.from(conn)`) picks the dialect — **mysql**, **sqlite** or **pg**. The same
code runs on all three; the fragment stays pure data and the dialect (identifier quoting +
placeholder style) is applied only at render time.

## The `` sql`…` `` tag

Interpolated values become **bound parameters**; nested `Sql` fragments compose:

```ts
const active = true;
const frag = sql`WHERE active = ${active} AND id = ${id}`;   // two bound params
db.query`SELECT * FROM usr ${frag}`;                          // fragment composes in
```

Helpers on `sql`:

- **`sql.id(name)`** — a dynamic identifier (table/column), quoted per dialect. Use this for any
  table/column name that isn't a literal in the template. Never build identifiers via `sql.raw`.
- **`sql.raw(text)`** — verbatim text, no quoting, no binding. Escape hatch only — **never pass
  user input** or values through it.
- **`sql.join(frags, sep = ", ")`** — join fragments (IN-lists, column sets):

  ```ts
  db.query`SELECT * FROM usr WHERE id IN (${sql.join(ids.map((i) => sql`${i}`))})`;
  ```

## What you can interpolate as a value

`toParam` (in item.js `sql.js`) decides how an interpolated value is bound:

| Value | Bound as |
|---|---|
| string, number, **boolean**, `null` | passed to the driver as-is |
| `Date`, `Uint8Array` | passed through (driver serializes) |
| an object with a **custom `toString`** | `String(v)` |
| a nested `` sql`…` `` fragment | composed into the query |
| a `Promise` | awaited first — see below |
| **plain object or array** | **throws `TypeError`** (would be mangled) |

So `${someObject}` only works if the object has its own `toString`; a plain `{}` or `[]` is a
mistake and fails loudly instead of producing broken SQL.

### Promises are awaited in parallel

`resolveSql()` runs before render and awaits every interpolated `Promise` **concurrently**
(`Promise.all`). A promise that resolves to a `Sql` fragment composes recursively. This lets you
interpolate async lookups without serial `await`s:

```ts
// both selects run in parallel, then the outer query renders
db.exec`INSERT INTO x (a, b) VALUES (${lookupA()}, ${lookupB()})`;
```

Note this parallelism is *within one statement's parameters*. It does not batch across statements.

## Booleans: always bind, never `= 1`

Bind boolean comparisons/assignments as `${true}` / `${false}` — never `= 1` / `= 0` / `= '1'`
and never bare MySQL-truthiness (`WHERE flag`):

```ts
db.exec`DELETE FROM m_error_report WHERE bot = ${true}`;   // ✓ every dialect
db.exec`DELETE FROM m_error_report WHERE bot = 1`;         // ✗ Postgres: boolean = integer error
```

**Why:** only a bound JS boolean is serialized per dialect (sqlite driver maps `boolean → 0/1`,
mysql2 → `1`, node-postgres → real `TRUE`). On a real PG `boolean` column, `= 1` throws
(`operator does not exist: boolean = integer`); a bare `WHERE intcol` throws too. `= 1` merely
trades a MySQL problem for a PG one. This applies **only to raw SQL** — `db.table().insert/update`
normalizes booleans through `DbField.valueTransform` (`1/"1"/"true"/true → true`) before binding,
so those are already dialect-safe. Write them as `true`/`false` anyway for readability.

A bare `WHERE boolcol` (no `= 1`) is valid in PG *if* the column is genuinely `boolean` — but
prefer the explicit `= ${true}` for one consistent rule. Watch for name collisions: `access` is a
boolean column somewhere, but `page_access.access` / `cms_access` / `sess.access` are
integer/timestamp — check the schema before "fixing" one.

## Running queries

All take a tagged template and return promises:

| Method | Returns |
|---|---|
| `db.query\`…\`` | `Row[]` — full result set |
| `db.row\`…\`` | first row or `undefined` |
| `db.col\`…\`` | first column of every row |
| `db.one\`…\`` | first column of the first row (scalar) or `undefined` |
| `db.indexCol\`…\`` | `{ firstCol: secondCol }` map |
| `db.exec\`…\`` | `ExecResult` (`affectedRows`, `insertId`) — for writes |

**Reads** go through `query` and its shortcuts. **Writes** should use `exec`: it returns
`affectedRows`/`insertId` and carries dialect specifics (e.g. PG `RETURNING` via
`db.exec(frag, "id")`). Using `db.query` for an `INSERT`/`UPDATE`/`DELETE` works on mysql/sqlite
but is the less portable path — prefer `exec`.

## Table helpers — the safe write path

`db.table(name)` is schema-aware and runs every value through `valueTransform` (boolean
normalization, date formatting, strict numeric coercion). Prefer it over hand-written write SQL:

```ts
await db.table("usr").insert({ email, active: true, superuser: false });
await db.table("usr").update({ id, active: false });   // one-arg: id read from the values
await db.table("usr").ensure({ id, name });             // update if the row exists, else insert
await db.table("usr").delete(id);                       // id may be scalar or a values object
```

- `insert()` / `update()` return the entry-id string; `delete()` returns a boolean.
- Composite keys: an id is either the encoded string (`"a:b"`) or a values object; `entryId()`
  encodes, `entryIdValues()` decodes.
- `ensure()` is read-then-write and **not** atomic (no upsert yet) — fine for boot/seeding, risky
  under heavy concurrency without a unique index.

## Transactions

`db.transaction(fn)` runs `fn` atomically; nested calls **join** the outer transaction rather than
starting a new one, so helpers that open their own transaction (e.g. `table.copy`) compose safely.

```ts
await db.transaction(async () => {
  await db.table("order").insert(order);
  await db.table("order_line").insert(line);
});
```

## Rules of thumb

- Dynamic identifier → `sql.id`. Value → interpolate directly (bound). Never `sql.raw` for either.
- Boolean in raw SQL → `${true}`/`${false}`. Row CRUD → `db.table(...)`.
- Writes → `db.exec` (or table helpers). Reads → `db.query`/`row`/`one`/`col`.
- A plain object/array in a value slot is a bug — it throws on purpose.
