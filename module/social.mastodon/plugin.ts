export { socialProvider } from "./mod.ts";

export const settingsSchema = {
  properties: {
    url: { type: "string", description: "HTTPS origin of the Mastodon server" },
    accessToken: { type: "string", description: "User token with profile, read:statuses, read:notifications and write:statuses" },
  },
};
