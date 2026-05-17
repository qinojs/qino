// deno-lint-ignore-file no-explicit-any
/**
 * Core API tree.
 *
 * The apt framework lives in ./lib/apt/mod.ts. This file contains only concrete
 * core endpoints.
 */

import { getCtx } from "./lib/RequestContext.ts";
import { $item, type Item } from "../../deps.ts";
import { Access, AccessError, ConflictError, type AptTree } from "./lib/apt/mod.ts";
import { s } from "./lib/StandardSchema.ts";
import { pwVerify, pwHash, logout } from "./lib/auth.ts";
import { readSettings } from "./lib/settings.ts";

const pathParam = s.array(s.string()).describe("Sub-path, e.g. [\"foo\", \"bar\"]");

async function appSettingsRoot(path?: string[]): Promise<Item> {
  const ctx = getCtx();
  if (!(await ctx.user?.get?.("superuser"))) throw new AccessError();
  return ctx.app.settings[$item].sub(path ?? []);
}

function ctxSettingsRoot(path?: string[]): Item {
  return getCtx().settings[$item].sub(path ?? []);
}

export const api: AptTree = {
  password: {
    put: {
      description: "Change the password of the logged-in user",
      access: Access.USER,
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
      access: Access.USER,
      execute: async () => {
        await logout(getCtx());
        return { ok: true };
      },
    },
  },

  settings: {
    ":path*": {
      paramSchema: pathParam,
      get: { description: "Read app settings at path", access: Access.SUPERUSER, execute: async ({ path }: any) => readSettings(await appSettingsRoot(path)) },
      put: {
        description: "Set app settings at path",
        access: Access.SUPERUSER,
        input: s.object({ value: s.any().describe("Value to set (any JSON type)") }),
        execute: async ({ path, value }: any) => {
          await (await appSettingsRoot(path)).set(value);
          return { ok: true };
        },
      },
      delete: {
        description: "Delete app settings at path",
        access: Access.SUPERUSER,
        execute: async ({ path }: any) => {
          if (!path?.length) throw new ConflictError("Cannot delete app settings root");
          await (await appSettingsRoot(path)).remove();
          return { ok: true };
        },
      },
    },
  },

  "settings-schema": {
    ":path*": {
      paramSchema: pathParam,
      get: { description: "Read app settings schema at path", access: Access.SUPERUSER, execute: async ({ path }: any) => (await appSettingsRoot(path)).schema ?? {} },
    },
  },

  "ctx-settings": {
    ":path*": {
      paramSchema: pathParam,
      get: {
        description: "Read user/session settings at path", 
        access: Access.USER, 
        execute: ({ path }: any) => readSettings(ctxSettingsRoot(path)) },
      put: {
        description: "Set user/session settings at path",
        access: Access.USER,
        input: s.object({ value: s.any().describe("Value to set (any JSON type)") }),
        execute: async ({ path, value }: any) => {
          await ctxSettingsRoot(path).set(value);
          return { ok: true };
        },
      },
      delete: {
        description: "Delete user/session settings at path",
        access: Access.USER,
        execute: async ({ path }: any) => {
          if (!path?.length) throw new ConflictError("Cannot delete user/session settings root");
          await ctxSettingsRoot(path).remove();
          return { ok: true };
        },
      },
    },
  },

  "ctx-settings-schema": {
    ":path*": {
      paramSchema: pathParam,
      get: { description: "Read user/session settings schema at path", access: Access.USER, execute: ({ path }: any) => ctxSettingsRoot(path).schema ?? {} },
    },
  },
};
