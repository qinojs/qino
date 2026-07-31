import type { App } from "../core/mod.ts";
import { backend } from "../cms.backend/mod.ts";
import { clients, grants, render } from "./render.ts";
import api from "./nodeApi.ts";

export const name = "cms.backend.superuser.oauth_server";
export const description = "Manages OAuth clients, grants, and active authorizations.";
export const needs = ["cms.backend", "oauth_server"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "OAuth clients", de: "OAuth-Clients" });
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render,
    api,
    parts: { clients, grants },
  },
};
