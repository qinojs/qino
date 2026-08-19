// deno-lint-ignore-file no-explicit-any
/**
 * Core API tree.
 *
 * The api framework lives in ./lib/api/mod.ts. This file contains only concrete
 * core endpoints.
 */
import { createHash } from "node:crypto";

import { getCtx } from "./lib/ctx/Ctx.ts";
import { $item, sql } from "./deps.ts";
import { Access, AccessError, ApiError, ConflictError } from "./lib/api/mod.ts";
import { s } from "./lib/StandardSchema.ts";
import { beforeProof, loginNeeds, logout, pendingLogin, proofFailed, proofPassed, pwHash, pwVerify } from "./lib/auth/mod.ts";
import { itemReadDeep, unixTime } from "./lib/util.ts";

import type { ApiTree } from "./lib/api/mod.ts";

const pathParam = s.array(s.string()).describe("Sub-path, e.g. [\"foo\", \"bar\"]");

// `core.t` is public and unauthenticated. The client never sends more than T_WARN in one call,
// so anything above it is nobody we know.
// T_MAX stays under the tightest binding limit any backend brings (sqlite before 3.32 caps
// variables at 999). Keep T_WARN in step with MAX in core/pub/js/t.mjs.
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
      description: "Look up texts in the current language — unknown ones come back unchanged.",
      access: Access.PUBLIC,
      input: s.object({ texts: s.array(s.string()).describe(`At most ${T_WARN}`) }),
      execute: async ({ texts }: any) => {
        const ctx = getCtx();
        const { lang, langNs: ns, dev } = ctx;
        const list = [...new Set<string>(texts)]; // the same string twice is one lookup
        if (!list.length) return {}; // an empty `IN ()` is no SQL
        if (list.length > T_WARN) ctx.app.fire("suspicious", { ctx, reason: "oversized translation batch" }).catch(() => {});
        if (list.length > T_MAX) throw new ApiError(422, "too much to translate at once");
        const hashes = list.map((text) => createHash("md5").update(text).digest("hex"));
        const rows = await ctx.app.db.indexCol<string>`SELECT hash, ${sql.id(lang)} as txt FROM smalltext WHERE namespace = ${ns} AND hash IN (${sql.join(hashes.map((h: string) => sql`${h}`))})`;
        // keys are caller-supplied: on a plain object `__proto__` is swallowed and `toString` is inherited
        const result: Record<string, string> = Object.create(null);
        for (let i = 0; i < list.length; i++) {
          if (dev && !rows.has(hashes[i])) {
            await ctx.app.db.table("smalltext").insert({ namespace: ns, hash: hashes[i], original: list[i] });
          }
          result[list[i]] = rows.get(hashes[i]) || list[i];
        }
        return result;
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
          // Same reason as in auth's proof(): a stateless credential identifies a request, not the
          // session a proof would be written to. Nothing is guessed there, so nothing is counted.
          if (ctx.statelessAuth) throw new ApiError(422, "That password does not match");
          await beforeProof(ctx.app, ctx.userId);
          if (!await pwVerify(String(pw ?? ""), String(ctx.user?.pw ?? ""))) {
            await proofFailed(ctx.app, ctx.userId);
            ctx.app.fire("suspicious", { ctx, reason: "password step-up failed" }).catch(() => {});
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
      input: s.object({
        oldpw: s.string().describe("Current password"),
        pw: s.string().describe("New password (min 8 chars)"),
      }),
      execute: async ({ oldpw, pw }: any) => {
        const ctx = getCtx();
        const usr = ctx.user;
        if (!usr) throw new AccessError();
        if (!await pwVerify(oldpw, String(usr.pw ?? ""))) throw new ApiError(422, "The old password is incorrect");
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
        access: Access.PUBLIC, // nobody is signed in yet — that is the point
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
        // A stateless credential identifies a request, not a session — there is nothing here to end,
        // and the key stays valid either way. Say so instead of failing on the missing client.
        if (ctx.statelessAuth) throw new ApiError(409, "Nothing to log out — this request carries no session");
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
