// Public library API of @qino/core. The qino-module manifest is in ./plugin.ts.
// Consumers import from here (or "@qino/core") instead of reaching into
// core/lib/* — so they depend on this stable contract, not the file layout.
// NOTE: core-internal files must NOT import from this barrel; they import their
// siblings in ./lib/* directly, to avoid import cycles.

// App + request context
export { App } from "./lib/App.ts";
export type { AppEvents } from "./lib/App.ts";
export { Req } from "./lib/Req.ts";
export { honoAdapter } from "./lib/hono.ts";
export { getCtx, RequestContext, requestStorage } from "./lib/RequestContext.ts";
export { Csp } from "./lib/Csp.ts";

// HTML & general utilities
export { hee, u2time, HtmlString, html, Output, uid, urlize, clientIp, sqlSearchHelper, itemReadDeep, u2Root, contentDisposition } from "./lib/util.ts";

// Schema
export { s, StandardSchema, toJsonSchema } from "./lib/StandardSchema.ts";
export type { StandardIssue, StandardResult } from "./lib/StandardSchema.ts";

// apt framework: action tree, errors, adapters
export * from "./lib/apt/mod.ts";

// Database
export { Db } from "./lib/Db.ts";
export type { DbEvents } from "./lib/Db.ts";
export { Sql, sql } from "../../deps.ts";
export { dbScope, tableRef, scopeCache } from "./lib/dbScope.ts";
export type { DbScope } from "./lib/dbScope.ts";
export { DbEntry } from "./lib/DbEntry.ts";
export { DbField } from "./lib/DbField.ts";
export { DbFile } from "./lib/DbFileManager.ts";
export { DbText, DbTextLang } from "./lib/DbTextManager.ts";
export type { dbEntry_usr } from "./lib/qgEntries.ts";

// Modules
export { Module, ModuleManager } from "./lib/ModuleManager.ts";
export type { Plugin } from "./lib/ModuleManager.ts";

// Auth
export { login, pwHash } from "./lib/auth.ts";

// File transforms
export { FileTransformer } from "./lib/transform/index.ts";
export { isMagickAvailable, magick, magickIdentify } from "./lib/transform/imagemagick.ts";

// Server helpers used by modules
export { HtmlBuilder } from "./lib/HtmlBuilder.ts";
export { assertNoSSRF } from "./lib/fileStream.ts";
