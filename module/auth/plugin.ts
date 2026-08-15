import { Access, getCtx, s } from "@qino/qino";

import { approval } from "./approval.ts";
import { approvalPage } from "./view.ts";

import type { ApiTree, App, Params } from "@qino/qino";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

export const settingsSchema = {
  properties: {
    approval: {
      description: "Out-of-band user approval for sensitive API and MCP actions.",
      properties: {
        ttl: { type: "integer", default: 600, minimum: 60, maximum: 3600, description: "Seconds an approval remains usable." },
        pendingLimit: { type: "integer", default: 10, minimum: 1, maximum: 100, description: "Maximum pending approvals per user." },
        channels: { type: "string", default: "web_push,email,sms", description: "Notification channels in preference order, comma-separated." },
      },
    },
  },
};

export const api: ApiTree = {
  approval: {
    ":id": {
      paramSchema: s.string(),
      get: {
        description: "Read one action approval; callers can poll until it is approved or denied",
        access: Access.USER,
        execute: ({ id }: Params) => {
          const ctx = getCtx();
          return approval(ctx.app, ctx.userId, String(id));
        },
      },
    },
  },
};

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  app.on("route", async ({ ctx }) => {
    const prefix = "auth/approval/";
    if (ctx.req.appPath.startsWith(prefix)) await approvalPage(ctx, decodeURIComponent(ctx.req.appPath.slice(prefix.length)));
  }, { signal });
}
