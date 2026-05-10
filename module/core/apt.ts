// deno-lint-ignore-file no-explicit-any
/**
 * Core API tree.
 *
 * The apt framework lives in ./lib/apt.ts. This file contains only concrete
 * core endpoints.
 */

import { getCtx } from "./lib/RequestContext.ts";
import { $item } from "../../deps.ts";
import { AccessError } from "./lib/apt.ts";
import { s } from "./lib/StandardSchema.ts";
import { pwVerify, pwHash, logout } from "./lib/auth.ts";
import { readSettings } from "./lib/settings.ts";
import type { Item } from "../../deps.ts";
import type { AptTree } from "./lib/apt.ts";

function pathParts(path?: string): string[] {
  return String(path ?? "").split("/").filter(Boolean);
}

async function appSettingsRoot(path?: string): Promise<Item> {
  const ctx = getCtx();
  if (!(await ctx.user?.get?.("superuser"))) throw new AccessError();
  return ctx.app.settings[$item].sub(pathParts(path));
}

function ctxSettingsRoot(path?: string): Item {
  return getCtx().settings[$item].sub(pathParts(path));
}

export const api: AptTree = {
  password: {
    put: {
      description: "Change the password of the logged-in user",
      input: s.object({
        oldpw: s.string().describe("Current password"),
        pw: s.string().describe("New password (min 5 chars)"),
      }),
      execute: async ({ oldpw, pw }: any) => {
        const ctx = getCtx();
        const usr = ctx.user;
        if (!usr) return 0;
        const currentHash = String(await usr.get("pw") ?? "");
        if (!await pwVerify(oldpw, currentHash)) return -1;
        if (String(pw ?? "").length < 5) return -2;
        await usr.set("pw", await pwHash(pw));
        await usr.save();
        return 1;
      },
    },
  },

  logout: {
    post: {
      description: "Logout current session",
      execute: async () => {
        await logout(getCtx());
        return { ok: true };
      },
    },
  },

  settings: {
    get: {
      description: "Read app settings",
      input: s.object({ path: s.optional(s.string()).describe("Sub-path, e.g. \"foo/bar\"") }),
      execute: async ({ path }: any) => readSettings(await appSettingsRoot(path)),
    },
    put: {
      description: "Set app settings",
      input: s.object({
        path: s.optional(s.string()).describe("Sub-path, e.g. \"foo/bar\""),
        value: s.any().describe("Value to set (any JSON type)"),
      }),
      execute: async ({ path, value }: any) => {
        await (await appSettingsRoot(path)).set(value);
        return { ok: true };
      },
    },
    delete: {
      description: "Delete app settings at given path",
      input: s.object({ path: s.string().describe("Sub-path to delete") }),
      execute: async ({ path }: any) => {
        await (await appSettingsRoot(path)).remove();
        return { ok: true };
      },
    },
  },

  "settings-schema": {
    get: {
      description: "Read app settings schema",
      input: s.object({ path: s.optional(s.string()).describe("Sub-path, e.g. \"foo/bar\"") }),
      execute: async ({ path }: any) => (await appSettingsRoot(path)).schema ?? {},
    },
  },

  "ctx-settings": {
    get: {
      description: "Read user/session settings",
      input: s.object({ path: s.optional(s.string()).describe("Sub-path, e.g. \"foo/bar\"") }),
      execute: ({ path }: any) => readSettings(ctxSettingsRoot(path)),
    },
    put: {
      description: "Set user/session settings",
      input: s.object({
        path: s.optional(s.string()).describe("Sub-path, e.g. \"foo/bar\""),
        value: s.any().describe("Value to set (any JSON type)"),
      }),
      execute: async ({ path, value }: any) => {
        await ctxSettingsRoot(path).set(value);
        return { ok: true };
      },
    },
    delete: {
      description: "Delete user/session settings at given path",
      input: s.object({ path: s.string().describe("Sub-path to delete") }),
      execute: async ({ path }: any) => {
        await ctxSettingsRoot(path).remove();
        return { ok: true };
      },
    },
  },

  "ctx-settings-schema": {
    get: {
      description: "Read user/session settings schema",
      input: s.object({ path: s.optional(s.string()).describe("Sub-path, e.g. \"foo/bar\"") }),
      execute: ({ path }: any) => ctxSettingsRoot(path).schema ?? {},
    },
  },
};
