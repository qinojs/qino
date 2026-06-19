// Hono is only used by the optional mount adapter lib/hono.ts (honoAdapter).
export { Hono } from "npm:hono@^4";
export { basePath } from "npm:hono@^4/route";
export { getConnInfo } from "npm:hono@^4/deno";
export { default as mysql } from "npm:mysql2@^3/promise";
export { default as postgres } from "npm:pg@^8";
export type { Pool, ResultSetHeader, RowDataPacket } from "npm:mysql2@^3/promise";
export { default as bcrypt } from "npm:bcryptjs@^3";
export { serveFile } from "jsr:@std/http@^1/file-server";
export { fromFileUrl, isAbsolute, toFileUrl } from "jsr:@std/path@^1";
export { typeByExtension } from "jsr:@std/media-types@^1";

export { Item, $item, type ItemProxy } from "jsr:@nuxodin/item@0.5.16/item.js";
export { bildJsonItem } from "jsr:@nuxodin/item@0.5.16/tools/jsonDataItem.js";
// For local item.js development: swap each jsr line for the commented file:// line below.
export { schemaToDb as schemaToDbMysql } from "jsr:@nuxodin/item@0.5.16/tools/schema/db/mysql/to-db.js";
export { schemaToDb as schemaToDbSqlite } from "jsr:@nuxodin/item@0.5.16/tools/schema/db/sqlite/to-db.js";
export { schemaToDb as schemaToDbPg } from "jsr:@nuxodin/item@0.5.16/tools/schema/db/pg/to-db.js";
export { schemaFromDb } from "jsr:@nuxodin/item@0.5.16/tools/schema/db/mysql/from-db.js";

// export { schemaToDb as schemaToDbMysql } from "file:///var/www/workplace/nuxodin/item.js/tools/schema/db/mysql/to-db.js";
// export { schemaToDb as schemaToDbSqlite } from "file:///var/www/workplace/nuxodin/item.js/tools/schema/db/sqlite/to-db.js";
// export { schemaToDb as schemaToDbPg } from "file:///var/www/workplace/nuxodin/item.js/tools/schema/db/pg/to-db.js";
// export { schemaFromDb } from "file:///var/www/workplace/nuxodin/item.js/tools/schema/db/mysql/from-db.js";

export { schemaDiff } from "jsr:@nuxodin/item@0.5.16/tools/schema/diff.js";
export { toInput } from "jsr:@nuxodin/item@0.5.16/tools/schema/render/html.js";

export { dump } from "jsr:@nuxodin/dump@^1.5.2";
