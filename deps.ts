// Hono is only used by the optional mount adapters (lib/hono.ts, apt/toHono.ts).
export { Hono } from "npm:hono@^4";
export type { Context } from "npm:hono@^4";
export { basePath } from "npm:hono@^4/route";
export { default as mysql } from "npm:mysql2@^3/promise";
export type { Pool, ResultSetHeader, RowDataPacket } from "npm:mysql2@^3/promise";
export { default as bcrypt } from "npm:bcryptjs@^3";
export { serveFile } from "jsr:@std/http@^1/file-server";
export { fromFileUrl, isAbsolute, toFileUrl } from "jsr:@std/path@^1";
export { typeByExtension } from "jsr:@std/media-types@^1";

export { Item, $item, type ItemProxy } from "jsr:@nuxodin/item@^0.5.8/item.js";
export { bildJsonItem } from "jsr:@nuxodin/item@^0.5.8/tools/jsonDataItem.js";
export { schemaToDb } from "jsr:@nuxodin/item@^0.5.8/tools/schema/db/mysql/to-db.js";
export { schemaFromDb } from "jsr:@nuxodin/item@^0.5.8/tools/schema/db/mysql/from-db.js";
export { schemaDiff } from "jsr:@nuxodin/item@^0.5.8/tools/schema/diff.js";
export { toInput } from "jsr:@nuxodin/item@^0.5.8/tools/schema/render/html.js";

export { dump } from "jsr:@nuxodin/dump@^1.5.2";
