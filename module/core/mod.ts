// Public library API of @qino/core. The qino-module manifest is in ./plugin.ts.
// Consumers import from here (or "@qino/core") instead of reaching into
// core/lib/* — so they depend on this stable contract, not the file layout.
// NOTE: core-internal files must NOT import from this barrel; they import their
// siblings in ./lib/* directly, to avoid import cycles.

// App + request context
export { App } from "./lib/App.ts";
export type { AppEvents } from "./lib/App.ts";
export { Req } from "./lib/ctx/Req.ts";
export { honoAdapter } from "./lib/hono.ts";
export { getCtx, RequestContext, requestStorage } from "./lib/ctx/RequestContext.ts";
export { Csp } from "./lib/ctx/Csp.ts";

// HTML & general utilities
export { hee, u2time, unixTime, HtmlString, html, Output, uid, urlize, clientIp, sqlSearchHelper, itemReadDeep, u2Root, contentDisposition } from "./lib/util.ts";

// Schema
export { s, StandardSchema, toJsonSchema } from "./lib/StandardSchema.ts";
export type { StandardIssue, StandardResult } from "./lib/StandardSchema.ts";

// apt framework: action tree, errors, introspection
export { Access } from "./lib/apt/access.ts";
export { AptError, AccessError, NotFoundError, ConflictError, ValidationError } from "./lib/apt/errors.ts";
export { invoke } from "./lib/apt/invoke.ts";
export { walk, camelName, checkCollisions } from "./lib/apt/route.ts";
export type { Route } from "./lib/apt/route.ts";
export { toTools } from "./lib/apt/toTools.ts";
export type { Tool } from "./lib/apt/toTools.ts";
export { VERBS, RESERVED } from "./lib/apt/types.ts";
export type { AptNode, AptTree, Method, Params, Verb } from "./lib/apt/types.ts";
export type { AptProxy } from "./lib/apt/client.ts";

// Database
export { Db } from "./lib/db/Db.ts";
export type { DbEvents } from "./lib/db/Db.ts";
export type { Row } from "./lib/db/DbDriver.ts";
export { Sql, sql } from "../../deps.ts";
export { tableRef, scopeCache } from "./lib/db/dbScope.ts";
export type { DbScope } from "./lib/db/dbScope.ts";
export { DbEntry } from "./lib/db/DbEntry.ts";
export { DbField } from "./lib/db/DbField.ts";

export { DbFile } from "./lib/DbFileManager.ts";
export { DbText, DbTextLang } from "./lib/DbTextManager.ts";
export type { dbEntry_usr } from "./lib/qgEntries.ts";

// Modules
export { Module, ModuleManager } from "./lib/ModuleManager.ts";
export type { Plugin } from "./lib/ModuleManager.ts";

// Auth
export { login, pwHash } from "./lib/auth.ts";

// File transforms
export { FileTransformer } from "./lib/transform/mod.ts";
export type { OcrEngine, Transcript, TranscriptEngine, TranscriptSegment, TranscriptWord, TransformContext } from "./lib/transform/mod.ts";
export { isMagickAvailable, magickIdentify } from "./lib/transform/imagemagick.ts";

// Server helpers used by modules
export { HtmlBuilder } from "./lib/ctx/HtmlBuilder.ts";
export { safeFetch } from "./lib/fileStream.ts";
