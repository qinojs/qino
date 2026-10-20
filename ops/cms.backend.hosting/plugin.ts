import { backend } from "@qino/qino/cms.backend";

import api from "./nodeApi.ts";
import { list, render } from "./render.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App } from "@qino/qino";

const { name } = manifest;

export const settingsSchema = {
  properties: {
    socket: {
      type: "string",
      default: "/run/qino-hosting/hosting.sock",
      description: "Unix socket of the root helper (host/helper.ts).",
    },
  },
};

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Hosting", de: "Hosting" });
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
    parts: { list },
  },
};
