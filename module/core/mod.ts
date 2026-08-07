// Public library API of @qino/core. The qino-module manifest is in ./plugin.ts.
// Consumers import from here (or "@qino/core") instead of reaching into
// core/lib/* — so they depend on this stable contract, not the file layout.
// NOTE: core-internal files must NOT import from this barrel; they import their
// siblings in ./lib/* directly, to avoid import cycles.

// App + request context
export { App, appPathInstances } from "./lib/App.ts";
export type { AppEvents } from "./lib/App.ts";
export { honoAdapter } from "./lib/hono.ts";
export { getCtx, Ctx, requestStorage } from "./lib/ctx/Ctx.ts";
export { Emitter } from "./lib/Emitter.ts";
export { ResCsp } from "./lib/ctx/ResCsp.ts";

// HTML & general utilities
export { hee, unixTime, html, Output, Redirect, uid, b64url, unb64url, randB64, sha256, urlize, clientIp, sqlSearch, itemReadDeep, u2Root, header, isFile } from "./lib/util.ts";
// HtmlString is type-only on purpose: construct via html.raw / html.join (mirrors sql.raw / sql.join).
export type { HtmlString } from "./lib/util.ts";

// Schema
export { s, StandardSchema, toJsonSchema } from "./lib/StandardSchema.ts";

// api framework: action tree, errors, introspection
export { Access } from "./lib/api/access.ts";
export { ApiError, AccessError, NotFoundError, ConflictError, ValidationError } from "./lib/api/errors.ts";
export { invoke } from "./lib/api/invoke.ts";
export { isTrustedOrigin } from "./lib/api/fetch.ts";
export { walk, camelName, checkCollisions } from "./lib/api/route.ts";
export type { Route } from "./lib/api/route.ts";
export { toTools } from "./lib/api/toTools.ts";
export type { Tool } from "./lib/api/toTools.ts";
export { VERBS, RESERVED } from "./lib/api/types.ts";
export type { ApiNode, ApiTree, Method, Params, Verb } from "./lib/api/types.ts";

// Database
export { Db } from "./lib/db/Db.ts";
export type { DbEvents } from "./lib/db/Db.ts";
export type { Row } from "./lib/db/DbDriver.ts";
export { Sql, sql } from "./deps.ts";
export { tableRef, scopeCache } from "./lib/db/dbScope.ts";
export type { DbScope } from "./lib/db/dbScope.ts";
export { DbEntry } from "./lib/db/DbEntry.ts";
export { DbRow } from "./lib/db/DbRow.ts";
export { DbField } from "./lib/db/DbField.ts";

export { DbFile } from "./lib/DbFileManager.ts";
export { DbText, DbTextLang } from "./lib/DbTextManager.ts";
export type { dbEntry_usr } from "./lib/qgEntries.ts";

// item.js is core's dependency; other modules take it from here so there is only ever one copy of
// it — `$item` is a module-local Symbol that a second copy would silently stop matching.
export { $item, bildJsonItem, schemaDiff, schemaFromDb, toInput } from "./deps.ts";
export type { ItemProxy } from "./deps.ts";

// Modules
export { Module } from "./lib/ModuleManager.ts";
export { Store } from "./lib/StoreManager.ts";

// Auth
export { login, pwHash, pwVerify, safeEqual } from "./lib/auth.ts";

// File transforms
export { FileTransformer } from "./lib/transform/mod.ts";
export type { Transcript, TranscriptSegment, TranscriptWord } from "./lib/transform/mod.ts";
export * as magick from "./lib/transform/magick.ts";

// Server helpers used by modules
export { ResHtml } from "./lib/ctx/ResHtml.ts";
export { safeFetch } from "./lib/fileStream.ts";
