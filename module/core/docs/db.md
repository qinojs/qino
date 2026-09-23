# Database access

Layers, from low to high:

| Layer | What it is | Use for |
|---|---|---|
| `` sql`…` `` fragment | dialect-neutral AST (from item.js) | building reusable/composed SQL pieces |
| `db.query` / `row` / `col` / … | render a fragment and run it, returning rows | one-off **reads** |
| `db.exec` | render a fragment and run it, returning an `ExecResult` | one-off **writes** (INSERT/UPDATE/DELETE) |
| `db.table(name)` helpers | schema-aware `insert`/`update`/`ensure`/`delete`/`select` | normal row CRUD (the safe write path) |

The driver (`DbDriver.from(conn)`) picks the dialect — **mysql**, **sqlite** or **pg**. A fragment
is plain data; quoting and placeholders are applied only when it is rendered, so the same code runs
on all three.

## The `` sql`…` `` tag

Interpolated values become **bound parameters**; nested `Sql` fragments compose:

```ts
const active = true;
const frag = sql`WHERE active = ${active} AND id = ${id}`;   // two bound params
db.query`SELECT * FROM usr ${frag}`;                          // fragment composes in
```

Helpers on `sql`:

- **`sql.id(name)`** — a dynamic table or column name, quoted per dialect. Never use `sql.raw`
  for names.
- **`sql.raw(text)`** — text as is, no quoting, no binding. Last resort — **never pass user
  input** or values through it.
- **`sql.join(frags, sep = ", ")`** — join fragments (IN-lists, column sets):

  ```ts
  db.query`SELECT * FROM usr WHERE id IN (${sql.join(ids.map((i) => sql`${i}`))})`;
  ```

## What you can interpolate as a value

`toParam` (in item.js `sql.js`) decides how a value is bound:

| Value | Bound as |
|---|---|
| string, number, **boolean**, `null` | passed to the driver as-is |
| `Date`, `Uint8Array` | passed through (driver serializes) |
| an object with a **custom `toString`** | `String(v)` |
| a nested `` sql`…` `` fragment | composed into the query |
| a `Promise` | awaited first — see below |
| **plain object or array** | **throws `TypeError`** (would be mangled) |

So `${someObject}` needs its own `toString`; a plain `{}` or `[]` throws instead of producing
broken SQL.

### Promises are awaited in parallel

`resolveSql()` awaits all interpolated promises **in parallel** before rendering. A promise may
also resolve to a `Sql` fragment. So async lookups need no `await` one after another:

```ts
// both selects run in parallel, then the outer query renders
db.exec`INSERT INTO x (a, b) VALUES (${lookupA()}, ${lookupB()})`;
```

This works within one statement only, not across statements.

## Booleans: always bind, never `= 1`

Write booleans as `${true}` / `${false}` — never `= 1` / `= 0` / `= '1'` and never a bare
`WHERE flag`:

```ts
db.exec`DELETE FROM m_error_report WHERE bot = ${true}`;   // ✓ every dialect
db.exec`DELETE FROM m_error_report WHERE bot = 1`;         // ✗ Postgres: boolean = integer error
```

**Why:** only a bound JS boolean is converted per dialect (sqlite → `0/1`, mysql2 → `1`,
node-postgres → `TRUE`). On a PG `boolean` column, `= 1` throws
(`operator does not exist: boolean = integer`), and so does a bare `WHERE intcol`. This is **only
about raw SQL** — `db.table().insert/update` converts booleans in `DbField.valueTransform`
(`1/"1"/"true"/true → true`). Still write `true`/`false` there for readability.

Careful with names: `page_access.access`, `cms_access` and `sess.access` are integer/timestamp
columns, not booleans — check the schema first.

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

Use `query` and its shortcuts for **reads** and `exec` for **writes**: it returns
`affectedRows`/`insertId` and handles dialect details (e.g. PG `RETURNING` via
`db.exec(frag, "id")`). `db.query` with `INSERT`/`UPDATE`/`DELETE` works on mysql/sqlite, but not
everywhere.

## Table helpers — the safe write path

`db.table(name)` knows the schema and converts every value (booleans, dates, numbers). Prefer it
over hand-written write SQL:

```ts
await db.table("usr").insert({ email, active: true, superuser: false });
await db.table("usr").update({ id, active: false });   // one-arg: id read from the values
await db.table("usr").ensure({ id, name });             // update if the row exists, else insert
await db.table("usr").delete(id);                       // id may be scalar or a values object
```

- `insert()` / `update()` return the entry-id string; `delete()` returns a boolean.
- Composite keys: an id is either the encoded string (`"a:b"`) or a values object; `entryId()`
  encodes, `entryIdValues()` decodes.
- `ensure()` reads, then writes — **not** atomic. Fine for seeding; under heavy concurrency it
  needs a unique index.

## Rows — data and behaviour in one object

`db.table(name)` also returns row objects: one object per row, columns as plain properties, the
row's own API prefixed with `$`.

```ts
const usr = await db.table("usr").get<Usr>(5);            // loaded row, or undefined
const active = await db.table("usr").all<Usr>`WHERE active = ${true}`;
const fresh = await db.table("usr").add<Usr>({ email });  // INSERT, then the loaded row
db.table("usr").row(5).email                              // handle without a query; a column reads sync
await usr.$set({ lang: "de" });                           // assign and write in one UPDATE
```

- Methods go into a subclass, set in the module's `init()`: `db.table("usr").rowClass = Usr`.
  Then `usr.contacts.add("email", "a@b.ch")` works — but only where the class is registered, so
  library code uses the free functions (`addContact(db, …)`) the class calls.
  Columns are data, methods are verbs — `grps()`, `pricesFor()`, never `price()` next to a `price` column.
- A method with the same name as a column throws when the class is registered.
- A write through the table invalidates the row object. Unsaved changes are written at the end of
  the microtask, even if nobody awaits `$save()`.

## Transactions

`db.transaction(fn)` runs `fn` atomically. Nested calls **join** the outer transaction, so helpers
with their own transaction (e.g. `table.copy`) can be combined.

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
