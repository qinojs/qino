import { s } from "./StandardSchema.ts";
import { Ctx } from "./ctx/Ctx.ts";
import { DbFile } from "./DbFileManager.ts";

import type { EventDecls, EventsOf } from "./Emitter.ts";

const ctx = s.instance(Ctx);

/** Core events of an App. */
export const appEvents = {
    "request-start": { data: s.object({ request: s.instance(Request), peerAddr: s.string(), time: s.number(), base: s.string() }) },
    "authenticate": { data: s.object({ ctx }) },
    "route": { data: s.object({ ctx }) },
    "render": { data: s.object({ ctx }) },
    "html-ready": { data: s.object({ ctx }) },
    "respond": { data: s.object({ ctx }) },
    "response-ready": { data: s.object({
        request: s.instance(Request), res: s.instance(Response), peerAddr: s.string(), time: s.number(),
        ctx: s.optional(ctx), // no ctx for static files and early errors
    }) },
    "suspicious": {
        description: "A request looks like abuse; listeners score the client.",
        data: s.object({
            ctx: ctx.describe("The suspicious request."),
            weight: s.optional(s.number().describe("How suspicious, default 1.")),
            reason: s.optional(s.string().describe("Why, in a few words.")),
        }),
    },
    "auth:login": {
        description: "A user signed in.",
        data: s.object({
            oldSession: s.record<any>().describe("The session's values before it was emptied."),
            usrId: s.number().describe("The user who signed in."),
        }),
    },
    "dbFile:access": { data: s.object({ file: s.instance(DbFile), access: s.boolean() }) },          // fast path
    "dbFile:access-fallback": { data: s.object({ file: s.instance(DbFile), access: s.boolean() }) }, // slow path, only if access is still unresolved
    "dbFile:unlink-before": {
        description: "A file is about to be deleted.",
        data: s.object({
            file: s.instance(DbFile).describe("The file."),
            prevent: s.boolean().describe("Set to true to keep it."),
        }),
    },
} satisfies EventDecls;

/** Payloads of the core events. Module events work but are untyped — JSR forbids augmenting this map from a module. */
export type AppEvents = EventsOf<typeof appEvents>;
