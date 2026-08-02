import type { App } from "../core/mod.ts";
import { backend } from "../cms.backend/mod.ts";
import { channels, render, send, subscriptions } from "./render.ts";
import api from "./nodeApi.ts";

export const name = "cms.backend.superuser.web_push";
export const description = "Lists Web Push subscriptions and sends notifications to them.";
export const needs = ["cms.backend", "messaging.web_push"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Web Push", de: "Web Push" });
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render,
    api,
    parts: { channels, send, subscriptions },
  },
};
