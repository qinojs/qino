export { socialProvider } from "./mod.ts";

export const settingsSchema = {
  properties: {
    accessToken: { type: "string", description: "OAuth user access token with tweet.read, users.read and tweet.write" },
  },
};
