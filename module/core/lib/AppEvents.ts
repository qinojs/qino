import { s } from "./StandardSchema.ts";
import { Ctx } from "./ctx/Ctx.ts";
import { DbFile } from "./DbFileManager.ts";

import type { EventDecls, EventsOf } from "./Emitter.ts";

const ctx = s.instance(Ctx).describe("The request.");
const dbFile = s.instance(DbFile).describe("The dbFile.");

/** Core events of an App. */
export const appEvents = {
    "request-start": {
        description: "A request came in; nothing is loaded yet.",
        data: s.object({
            request: s.instance(Request),
            peerAddr: s.string().describe("The client's address."),
            time: s.number().describe("Start, from performance.now()."),
            base: s.string().describe("The path the app is served under."),
        }),
    }, // cheap pre-filter, before any DB/session work
    "authenticate": { description: "Identify the client, before the session is loaded.", data: s.object({ ctx }) },
    "route": { description: "The request is set up and about to be routed.", data: s.object({ ctx }) },
    "render": { description: "Render a page; not fired for api and dbFile requests.", data: s.object({ ctx }) },
    "html-ready": { description: "The html document is about to be serialized.", data: s.object({ ctx }) },
    "respond": { description: "The response is about to be built.", data: s.object({ ctx }) },
    "response-ready": {
        description: "A response is about to be sent, for every request.",
        data: s.object({
            request: s.instance(Request),
            res: s.instance(Response),
            peerAddr: s.string().describe("The client's address."),
            time: s.number().describe("Start, from performance.now()."),
            ctx: s.optional(ctx), // no ctx for static files and early errors
        }),
    },
    "suspicious": {
        description: "Something looks suspicious; listeners score the client.",
        data: s.object({
            ctx: ctx.describe("The request it happened in."),
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
    "dbFile:access": {
        description: "May the current user read this dbFile? Fast path.",
        data: s.object({ file: dbFile, access: s.boolean().describe("Set to grant or deny.") }),
    },
    "dbFile:access-fallback": {
        description: "May the current user read this dbFile? Slow path, only if access is still unresolved.",
        data: s.object({ file: dbFile, access: s.boolean().describe("Set to grant.") }),
    },
    "dbFile:unlink-before": {
        description: "A dbFile was deleted; its stored content is about to be removed.",
        data: s.object({
            file: dbFile,
            prevent: s.boolean().describe("Set to true to keep the stored content."),
        }),
    },
} satisfies EventDecls;

/** Payloads of the core events. Module events work but are untyped — JSR forbids augmenting this map from a module. */
export type AppEvents = EventsOf<typeof appEvents>;
