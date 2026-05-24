import { backend } from "../cms.backend/mod.ts";
import { render } from "./render.ts";
import type { App } from "../core/server.ts";

export const name = "cms.backend.superuser.db";
export const needs = ["cms.backend"];

export async function install({ app }: { app: App }): Promise<void> {
  const P = await backend.install(app, name);
  if (P) {
    await P.title("en", "DB Manager");
  }
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    render,
  },
};
