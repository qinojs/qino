import { receive, socialProvider } from "./mod.ts";

import type { App } from "@qino/qino";

export { socialProvider };

export const settingsSchema = {
  properties: {
    targets: {
      type: "string",
      description: "Comma- or whitespace-separated channel/group ids or @usernames the bot may publish to",
    },
  },
};

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  app.on("telegram:update", ({ update }) => receive(app, update), { signal });
}
