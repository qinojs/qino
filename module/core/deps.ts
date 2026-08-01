// Third-party surface of core. Versions are pinned in deno.json, never here — and item.js is
// core's dependency alone: other modules take it from mod.ts, so a later package split cannot end
// up with two copies (its `$item` is a module-local Symbol; two copies would silently stop matching).
// Hono is only used by the optional mount adapter lib/hono.ts (honoAdapter).
export { Hono } from "hono";
export { basePath } from "hono/route";
export { getConnInfo } from "hono/deno";
export { default as mysql } from "mysql2/promise";
export { default as postgres } from "pg";
export type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
export { default as bcrypt } from "bcryptjs";
export { serveFile } from "@std/http/file-server";
export { fromFileUrl, isAbsolute, toFileUrl } from "@std/path";
export { extension as extensionByType, typeByExtension } from "@std/media-types";

export { Item, $item, type ItemProxy } from "@qino/item/item.js";
export { bildJsonItem } from "@qino/item/tools/jsonDataItem.js";
export { sql, Sql, render, resolveSql, isTemplate } from "@qino/item/tools/db/sql.js";
export { mysql as mysqlDialect } from "@qino/item/tools/db/dialect/mysql.js";
export { sqlite as sqliteDialect } from "@qino/item/tools/db/dialect/sqlite.js";
export { pg as pgDialect } from "@qino/item/tools/db/dialect/pg.js";
export { schemaToDb as schemaToDbMysql } from "@qino/item/tools/schema/db/mysql/to-db.js";
export { schemaToDb as schemaToDbSqlite } from "@qino/item/tools/schema/db/sqlite/to-db.js";
export { schemaToDb as schemaToDbPg } from "@qino/item/tools/schema/db/pg/to-db.js";
export { schemaFromDb } from "@qino/item/tools/schema/db/mysql/from-db.js";
export { schemaDiff } from "@qino/item/tools/schema/diff.js";
export { toInput } from "@qino/item/tools/schema/render/html.js";
