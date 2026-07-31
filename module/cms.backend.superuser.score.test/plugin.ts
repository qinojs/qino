import type { App, Ctx } from "../core/mod.ts";
import { backend } from "../cms.backend/mod.ts";
import { scored } from "../score/mod.ts";
import { fileHit, pageHit, TABLES } from "./hooks.ts";
import { list, render } from "./render.ts";
import api from "./nodeApi.ts";

export const name = "cms.backend.superuser.score.test";
export const description = "Exercises score tracking with CMS page and file access events.";
export const needs = ["cms.backend", "cms", "score"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Score test", de: "Score-Test" });
}

export async function init(app: App, { signal }: { signal: AbortSignal }): Promise<void> {
  for (const [tbl, half] of Object.entries(TABLES)) await scored(app.db, tbl, half);

  // The blocks drop what the hooks return: `fire` awaits a listener's promise, and no
  // request may wait for a score write.
  app.on("cms:page-ready", ({ ctx }: { ctx: Ctx }) => { pageHit(app, ctx); }, { signal });
  app.on("dbFile:access", ({ file, access }) => { fileHit(app, Number(file.id), access); }, { signal });
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render,
    api,
    parts: { list },
  },
};
