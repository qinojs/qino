export { homeProvider } from "./mod.ts";
export { init } from "./connection.ts";

export const settingsSchema = {
  title: "Home Assistant",
  properties: {
    url: { type: "string", title: "URL", format: "uri", pattern: "^(?:$|(?:https?|wss?)://[^\\s@/?#]+(?:[/?#]|$))", description: "Home Assistant base URL, including a reverse proxy path if needed" },
    accessToken: { type: "string", title: "Access token", writeOnly: true, description: "Server-side long-lived Home Assistant access token" },
  },
};
