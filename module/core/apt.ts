// deno-lint-ignore-file no-explicit-any
/**
 * Core API tree.
 *
 * The apt framework lives in ./lib/apt.ts. This file contains only concrete
 * core endpoints.
 */

import { getCtx } from "./lib/context.ts";
import { $item } from "../../deps.ts";
import { AccessError } from "./lib/apt.ts";
import { s } from "./lib/schema.ts";
import { Auth } from "./lib/Auth.ts";
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
      description: "Passwort des angemeldeten Users ändern.",
      input: s.object({ oldpw: s.string(), pw: s.string() }),
      execute: async ({ oldpw, pw }: any) => {
        const ctx = getCtx();
        const usr = ctx.user;
        if (!usr) return 0;
        const currentHash = String(await usr.get("pw") ?? "");
        if (!await Auth.pw_verify(oldpw, currentHash)) return -1;
        if (String(pw ?? "").length < 5) return -2;
        await usr.set("pw", await Auth.pw_hash(pw));
        await usr.save();
        return 1;
      },
    },
  },

  logout: {
    post: {
      description: "Aktuelle Session ausloggen.",
      execute: async () => {
        await Auth.logout();
        return { ok: true };
      },
    },
  },

  settings: {
    get: {
      description: "App-Settings lesen. Optional: path=foo/bar für Unterpfad.",
      input: s.object({ path: s.optional(s.string()) }),
      execute: async ({ path }: any) => readSettings(await appSettingsRoot(path)),
    },
    put: {
      description: "App-Settings setzen.",
      input: s.object({ path: s.optional(s.string()), value: s.any() }),
      execute: async ({ path, value }: any) => {
        await (await appSettingsRoot(path)).set(value);
        return { ok: true };
      },
    },
    delete: {
      description: "App-Settings löschen.",
      input: s.object({ path: s.string() }),
      execute: async ({ path }: any) => {
        await (await appSettingsRoot(path)).remove();
        return { ok: true };
      },
    },
  },

  "settings-schema": {
    get: {
      description: "Schema der App-Settings lesen. Optional: path=foo/bar für Unterpfad.",
      input: s.object({ path: s.optional(s.string()) }),
      execute: async ({ path }: any) => (await appSettingsRoot(path)).schema ?? {},
    },
  },

  "ctx-settings": {
    get: {
      description: "User-/Session-Settings lesen. Optional: path=foo/bar für Unterpfad.",
      input: s.object({ path: s.optional(s.string()) }),
      execute: ({ path }: any) => readSettings(ctxSettingsRoot(path)),
    },
    put: {
      description: "User-/Session-Settings setzen.",
      input: s.object({ path: s.optional(s.string()), value: s.any() }),
      execute: async ({ path, value }: any) => {
        await ctxSettingsRoot(path).set(value);
        return { ok: true };
      },
    },
    delete: {
      description: "User-/Session-Settings löschen.",
      input: s.object({ path: s.string() }),
      execute: async ({ path }: any) => {
        await ctxSettingsRoot(path).remove();
        return { ok: true };
      },
    },
  },

  "ctx-settings-schema": {
    get: {
      description: "Schema der User-/Session-Settings lesen. Optional: path=foo/bar für Unterpfad.",
      input: s.object({ path: s.optional(s.string()) }),
      execute: ({ path }: any) => ctxSettingsRoot(path).schema ?? {},
    },
  },
};
