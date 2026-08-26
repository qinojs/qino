export { socialProvider } from "./mod.ts";

export const settingsSchema = {
  properties: {
    accessToken: { type: "string", description: "Threads user access token with threads_basic and threads_content_publish" },
  },
};
