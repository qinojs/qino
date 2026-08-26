export { socialProvider } from "./mod.ts";

export const settingsSchema = {
  properties: {
    url: { type: "string", default: "https://bsky.social", description: "HTTPS origin of the account's Personal Data Server" },
    handle: { type: "string", description: "Bluesky handle" },
    appPassword: { type: "string", description: "Bluesky app password" },
  },
};
