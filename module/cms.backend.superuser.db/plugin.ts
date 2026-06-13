import { backend } from "../cms.backend/mod.ts";
import { render } from "./render.ts";
import type { App } from "../core/mod.ts";

export const name = "cms.backend.superuser.db";
export const needs = ["cms.backend"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "DB Manager", de: "DB Manager" });
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    js: ["pub/main.js"],
    render,
  },
};
