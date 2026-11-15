export { default as dbSchema } from "./dbschema.json" with { type: "json" };
export { calendar } from "./calendar.ts";

export const settingsSchema = { properties: {
  time_zone: { type: "string", default: "UTC", description: "IANA time zone of events whose node sets none, e.g. Europe/Zurich." },
} };
