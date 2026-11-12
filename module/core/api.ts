// deno-lint-ignore-file no-explicit-any
/** Core API endpoints. The api framework is in ./lib/api/mod.ts. */

import { getCtx } from "./lib/ctx/Ctx.ts";
import { $item } from "./deps.ts";
import { Access, AccessError, ApiError, ConflictError } from "./lib/api/mod.ts";
import { s } from "./lib/StandardSchema.ts";
import { attempt, loginNeeds, logout, pendingLogin, proofPassed, pwHash, pwVerify } from "./lib/auth/mod.ts";
import { itemReadDeep, unixTime } from "./lib/util.ts";

import type { ApiTree } from "./lib/api/mod.ts";

const pathParam = s.array(s.string()).describe("Sub-path, e.g. [\"foo\", \"bar\"]");

// `core.t` is public. Our client never sends more than T_WARN per call, so more is suspicious.
// T_MAX stays below the lowest bind limit (sqlite < 3.32: 999 variables). Keep T_WARN in sync with
// MAX in core/pub/js/t.js.
const T_WARN = 400;
const T_MAX = 420;

function appSettingsRoot(path?: string[]) {
  const ctx = getCtx();
  if (!ctx.user?.superuser) throw new AccessError();
  return ctx.app.settings[$item].sub(path ?? []);
}

function ctxSettingsRoot(path?: string[]) {
  return getCtx().settings[$item].sub(path ?? []);
}

export const api: ApiTree = {

  t: {
    post: {
      description: "Look up texts in the current language, in a namespace (default: the global one) — as t`` on the server; unknown ones come back unchanged.",
      access: Access.PUBLIC,
      input: s.object({
        texts: s.array(s.string()).describe(`At most ${T_WARN}`),
        ns: s.optional(s.string()).describe("Namespace, e.g. cms; empty or unknown: the global one"),
      }),
      execute: ({ texts, ns }: any) => {
        const ctx = getCtx();
        if (texts.length > T_WARN) ctx.app.fire("suspicious", { ctx, reason: "oversized translation batch" }).catch(() => {});
        if (texts.length > T_MAX) throw new ApiError(422, "too much to translate at once");
        return ctx.app.languages.lookup(texts, ns ?? "", ctx);
      },
    },
  },

  languages: {
    get: {
      description: "Available languages: all (first = default) and the one this request uses when a call omits `lang`",
      access: Access.PUBLIC,
      execute: () => {
        const ctx = getCtx();
        return { all: ctx.app.languages.all, def: ctx.app.languages.def, current: ctx.lang };
      },
    },
  },

  password: {
    verify: {
      post: {
        description: "Prove the signed-in user is present by typing their password again (step-up)",
        access: Access.USER,
        input: s.object({ pw: s.string() }),
        execute: async ({ pw }: any) => {
          const ctx = getCtx();
          if (!await attempt(ctx.app, ctx.userId, () => pwVerify(String(pw ?? ""), String(ctx.user?.pw ?? "")))) {
            ctx.app.fire("suspicious", { ctx, weight: 2, reason: "password step-up failed" }).catch(() => {});
            throw new ApiError(422, "That password does not match");
          }
          await proofPassed(ctx.app, ctx.userId);
          ctx.sess.data.core.via.password(unixTime());
          return { ok: true };
        },
      },
    },
    put: {
      description: "Change the password of the logged-in user",
      access: Access.USER,
      requireStepUp: true,
      input: s.object({ pw: s.string().describe("New password (min 8 chars)") }),
      execute: async ({ pw }: any) => {
        const usr = getCtx().user;
        if (!usr) throw new AccessError();
        if (String(pw ?? "").length < 8) throw new ApiError(422, "The password is too short");
        await usr.$set({ pw: await pwHash(pw) });
        return { ok: true };
      },
    },
  },

  login: {
    missing: {
      get: {
        description: "The factors that would finish the login this session has under way",
        access: Access.PUBLIC, // nobody is signed in yet
        execute: async () => {
          const ctx = getCtx();
          const open = pendingLogin(ctx);
          return { factors: open ? await loginNeeds(ctx, open.usrId, open.via) : [] };
        },
      },
    },
  },

  logout: {
    post: {
      description: "Logout current session",
      access: Access.USER,
      execute: async () => {
        const ctx = getCtx();
        // A token signs in its actor while valid; logout would be undone by the next request.
        if (ctx.statelessAuth) throw new ApiError(409, "Nothing to log out — this request carries a credential, not a login");
        await logout(ctx);
        return { ok: true };
      },
    },
  },

  settings: {
    ":path*": {
      paramSchema: pathParam,
      get: { description: "Read app settings at path", access: Access.SUPERUSER, query: s.object({ schema: s.optional(s.boolean()).describe("If true, return the JSON schema instead of the value") }), execute: ({ path, schema }: any) => schema ? appSettingsRoot(path).schema ?? {} : itemReadDeep(appSettingsRoot(path)) },
      put: {
        description: "Set app settings at path",
        access: Access.SUPERUSER,
        input: s.object({ value: s.any().describe("Value to set (any JSON type)") }),
        execute: async ({ path, value }: any) => {
          await appSettingsRoot(path).set(value);
          return { ok: true };
        },
      },
      delete: {
        description: "Delete app settings at path",
        access: Access.SUPERUSER,
        execute: async ({ path }: any) => {
          if (!path?.length) throw new ConflictError("Cannot delete app settings root");
          await appSettingsRoot(path).remove();
          return { ok: true };
        },
      },
    },
  },

  "ctx-settings": {
    ":path*": {
      paramSchema: pathParam,
      get: {
        description: "Read user/session settings at path",
        access: Access.USER,
        query: s.object({ schema: s.optional(s.boolean()).describe("If true, return the JSON schema instead of the value") }),
        execute: ({ path, schema }: any) => schema ? ctxSettingsRoot(path).schema ?? {} : itemReadDeep(ctxSettingsRoot(path)) },
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

};
