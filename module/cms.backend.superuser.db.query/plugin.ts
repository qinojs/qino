import { backend } from "../cms.backend/mod.ts";
import { render } from "./render.ts";
import type { App } from "../core/mod.ts";
import manifest from "./manifest.json" with { type: "json" };
const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "SQL Console", de: "SQL-Konsole" });
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    js: ["pub/main.js"],
    render,
  },
};
