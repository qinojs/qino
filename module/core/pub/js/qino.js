// Client-side counterpart of the server-side `app`/`ctx`.
//
//   import { ctx } from "./qino.js";
//
//   await ctx.app.api.core.user.me.get();   // RPC         (like server-side ctx.app.api.…)
//   await ctx.app.t`Hallo ${name}`;         // translation (like server-side app.t`…`)
//   ctx.lang / ctx.csrfToken / ctx.appUrl / ctx.moduleUrl / ctx.dev
//
// Only what the server calls ctx lives here. Its parts have their own modules and are imported from
// there: ./api.js, ./t.js, and ./settings.js — visitor settings are not request state on the client.

import { api } from "./api.js";
import { t } from "./t.js";

const appUrl = globalThis.qino?.appUrl ?? "/";

export const ctx = {
  app: { api, t },         // server-side: ctx.app → app.api / app.t
  lang: document.documentElement.getAttribute("lang"),
  appUrl,
  moduleUrl: appUrl + "m/",   // same as server-side: appUrl + "m/"
  dev: !!globalThis.qino?.dev,
  csrfToken: globalThis.qino?.csrfToken,
};

// server-side: import { getCtx } ... — client-side there is only the one ctx
export function getCtx() { return ctx; }
