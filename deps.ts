// Hono is only used by the optional mount adapter lib/hono.ts (honoAdapter).
export { Hono } from "npm:hono@^4";
export { basePath } from "npm:hono@^4/route";
export { getConnInfo } from "npm:hono@^4/deno";
export { default as mysql } from "npm:mysql2@^3/promise";
export { default as postgres } from "npm:pg@^8";
export type { Pool, ResultSetHeader, RowDataPacket } from "npm:mysql2@^3/promise";
export { default as bcrypt } from "npm:bcryptjs@^3";
// @ts-types="npm:@types/sanitize-html@^2"
export { default as sanitizeHtml } from "npm:sanitize-html@^2";
export { serveFile } from "jsr:@std/http@^1/file-server";
export { fromFileUrl, isAbsolute, toFileUrl } from "jsr:@std/path@^1";
export { extension as extensionByType, typeByExtension } from "jsr:@std/media-types@^1";

export { Item, $item, type ItemProxy } from "jsr:@nuxodin/item@0.6.3/item.js";
export { bildJsonItem } from "jsr:@nuxodin/item@0.6.3/tools/jsonDataItem.js";
export { sql, Sql, render, resolveSql, isTemplate } from "jsr:@nuxodin/item@0.6.3/tools/db/sql.js";
export { mysql as mysqlDialect } from "jsr:@nuxodin/item@0.6.3/tools/db/dialect/mysql.js";
export { sqlite as sqliteDialect } from "jsr:@nuxodin/item@0.6.3/tools/db/dialect/sqlite.js";
export { pg as pgDialect } from "jsr:@nuxodin/item@0.6.3/tools/db/dialect/pg.js";
// For local item.js development: swap each jsr line for the commented file:// line below.
export { schemaToDb as schemaToDbMysql } from "jsr:@nuxodin/item@0.6.3/tools/schema/db/mysql/to-db.js";
export { schemaToDb as schemaToDbSqlite } from "jsr:@nuxodin/item@0.6.3/tools/schema/db/sqlite/to-db.js";
export { schemaToDb as schemaToDbPg } from "jsr:@nuxodin/item@0.6.3/tools/schema/db/pg/to-db.js";
export { schemaFromDb } from "jsr:@nuxodin/item@0.6.3/tools/schema/db/mysql/from-db.js";

// export { schemaToDb as schemaToDbMysql } from "file:///var/www/workplace/nuxodin/item.js/tools/schema/db/mysql/to-db.js";
// export { schemaToDb as schemaToDbSqlite } from "file:///var/www/workplace/nuxodin/item.js/tools/schema/db/sqlite/to-db.js";
// export { schemaToDb as schemaToDbPg } from "file:///var/www/workplace/nuxodin/item.js/tools/schema/db/pg/to-db.js";
// export { schemaFromDb } from "file:///var/www/workplace/nuxodin/item.js/tools/schema/db/mysql/from-db.js";
// export { sql, Sql, render, resolveSql, isTemplate } from "file:///var/www/workplace/nuxodin/item.js/tools/db/sql.js";
// export { mysql as mysqlDialect } from "file:///var/www/workplace/nuxodin/item.js/tools/db/dialect/mysql.js";
// export { sqlite as sqliteDialect } from "file:///var/www/workplace/nuxodin/item.js/tools/db/dialect/sqlite.js";
// export { pg as pgDialect } from "file:///var/www/workplace/nuxodin/item.js/tools/db/dialect/pg.js";

export { schemaDiff } from "jsr:@nuxodin/item@0.6.3/tools/schema/diff.js";
export { toInput } from "jsr:@nuxodin/item@0.6.3/tools/schema/render/html.js";

export { dump } from "jsr:@nuxodin/dump@^1.5.2";
