// deno-lint-ignore-file no-explicit-any
import { backend } from "../cms.backend/mod.ts";
import { render } from "./render.ts";

export const name = "cms.backend.superuser.db";
export const needs = ["cms.backend"];

export async function install({ app }: any): Promise<void> {
  const P = await backend.install(app, name);
  if (P) {
    await P.title("en", "DB Manager");
    await P.title("de", "DB Manager");
  }
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    render,
  },
};
