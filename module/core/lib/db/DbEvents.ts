// deno-lint-ignore-file no-explicit-any
import { s } from "../StandardSchema.ts";
import { DbTable } from "./DbTable.ts";

import type { EventDecls, EventsOf } from "../Emitter.ts";
import type { StandardSchema } from "../StandardSchema.ts";

// annotated: DbTable and Db reference each other
const table: StandardSchema<DbTable> = s.instance(DbTable).describe("The table.");
const id = s.any().describe("The row's primary key.");
const data = s.record<any>().describe("The row's values, by column.");
const returnValue = s.optional(s.any().describe("Set to answer instead of the database."));

/** Core events of a Db. */
export const dbEvents = {
  "table:insert-before": { data: s.object({ table, data, returnValue }) },
  "table:insert-after": { description: "A row was inserted.", data: s.object({ table, id, data }) },
  "table:update-before": { data: s.object({ table, id, data, returnValue }) },
  "table:update-after": { description: "A row was updated.", data: s.object({ table, id, data }) },
  "table:delete-before": { data: s.object({ table, id, data, returnValue }) },
  "table:delete-after": { description: "A row was deleted.", data: s.object({ table, id, data }) },
} satisfies EventDecls;

/** Payloads of the core db events. Module events work but are untyped — JSR forbids augmenting this map from a module. */
export type DbEvents = EventsOf<typeof dbEvents>;
