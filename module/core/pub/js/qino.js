// Client-side counterpart of the server-side `app`/`ctx`.
//
//   import { ctx } from "./qino.js";
//   ctx.lang / ctx.csrfToken / ctx.appUrl / ctx.moduleUrl / ctx.dev
//
// Only what the page knows about itself; imports nothing. The rest has its own modules:
// ./api.js, ./t.js, ./settings.js.

const appUrl = globalThis.qino?.appUrl ?? "/";

export const ctx = {
  lang: document.documentElement.getAttribute("lang"),
  appUrl,
  moduleUrl: globalThis.qino?.moduleUrl ?? appUrl + "m/",  // from the server, includes the asset revision
  dev: !!globalThis.qino?.dev,
  csrfToken: globalThis.qino?.csrfToken,
};

// server: import { getCtx } ... — in the browser there is only one ctx
export function getCtx() { return ctx; }
