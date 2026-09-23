// Core-internal files must not import from here, but from ./lib/* directly (import cycles).

// App + request context
export { App } from "./lib/App.ts";
export type { AppEvents } from "./lib/App.ts";
export { honoAdapter } from "./lib/hono.ts";
export { getCtx, Ctx, requestStorage } from "./lib/ctx/Ctx.ts";
export { Emitter } from "./lib/Emitter.ts";
export { ResCsp } from "./lib/ctx/ResCsp.ts";
export { b64url, grant, keyed, randB64, safeEqual, sha256b64url, uid, unb64url } from "./lib/crypto.ts";

// HTML & general utilities
export { hee, unhee, unixTime, errMsg, isOn, isEmptyObject, html, moduleIcon, Output, Redirect, urlize, clientIp, sqlSearch, itemReadDeep, enableItemSchemaDefaults, u2Root, header } from "./lib/util.ts";
export { fs } from "./lib/fs.ts";
export { fillPlaceholders, modulePlaceholders, placeholderName, placeholderNames } from "./lib/templatePlaceholder.ts";
export type { TemplatePlaceholder, TemplateValue } from "./lib/templatePlaceholder.ts";
// HtmlString is type-only: create it via html.raw / html.join (like sql.raw / sql.join).
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
export { DbRow } from "./lib/db/DbRow.ts";
export { DbField } from "./lib/db/DbField.ts";

export { DbFile, deleteUnlinkedDbFiles } from "./lib/DbFileManager.ts";
export { DbText, DbTextLang } from "./lib/DbTextManager.ts";
export { Usr } from "./lib/rows.ts";
export { addContact, contactError, contactKey, contactOwner, contacts, contactTypes, countContacts, mainContact, removeContact, setMainContact, typeContacts } from "./lib/contacts.ts";

// Other modules import item.js from here, so there is one copy — a second copy would have its own
// `$item` Symbol.
export { $item, bildJsonItem, schemaDiff, schemaFromDb, toInput } from "./deps.ts";
export type { ItemProxy } from "./deps.ts";

// Modules
export { isModuleName, Module } from "./lib/ModuleManager.ts";
export { Store } from "./lib/StoreManager.ts";

// Auth
export { attempt, authFactors, identified, login, loginProof, proofPassed, pwHash, pwVerify, requireStepUp, userFactors } from "./lib/auth/mod.ts";
export type { AuthFactor, Offer } from "./lib/auth/factors.ts";

// File transforms
export { FileTransformer } from "./lib/transform/mod.ts";
export type { Transcript, TranscriptSegment, TranscriptWord } from "./lib/transform/mod.ts";
export * as magick from "./lib/transform/magick.ts";

// Server helpers used by modules
export { ResHtml } from "./lib/ctx/ResHtml.ts";
export { safeFetch } from "./lib/fileStream.ts";
export type { UploadedFile } from "./lib/fileStream.ts";
