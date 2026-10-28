import { Output } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";

import { intake } from "./lib/intake.ts";
import api from "./nodeApi.ts";
import { errors, instances, render } from "./render.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App } from "@qino/qino";

const { name } = manifest;

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

export const settingsSchema = {
  properties: {
    open: {
      type: "boolean",
      default: true,
      description: "Unknown instances register with their first report. Off: only known ones are taken.",
    },
  },
};

/** The address instances of `reporting` post to: {appUrl}reporting. */
export function init(app: App, { signal }: { signal: AbortSignal }): void {
  app.on("route", async ({ ctx }) => {
    if (ctx.req.appPath !== "reporting") return;
    if (ctx.req.method !== "POST") throw new Output("POST only", { status: 405 });
    const open = Boolean(await app.settings[name].open);
    const failed = await intake(app, ctx.req.header("authorization") ?? "", ctx.req.body, ctx.req.clientIp, open);
    if (failed) throw new Output({ error: failed }, { status: 403 });
    throw new Output({ ok: true });
  }, { signal });
}

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Reporting server", de: "Reporting-Server" });
}

export async function uninstall({ app }: { app: App }): Promise<void> {
  await backend.uninstall(app, name);
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    js: ["pub/main.js"],
    render,
    api,
    parts: { instances, errors },
  },
};
