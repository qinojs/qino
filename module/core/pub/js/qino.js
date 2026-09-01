// Client-side counterpart of the server-side `app`/`ctx`.
//
//   import { ctx } from "./qino.js";
//   ctx.lang / ctx.csrfToken / ctx.appUrl / ctx.moduleUrl / ctx.dev
//
// What the page knows about itself, and nothing else — so this module imports nothing. The rest of
// what the server keeps on its ctx has its own module here: ./api.js, ./t.js, ./settings.js.

const appUrl = globalThis.qino?.appUrl ?? "/";

export const ctx = {
  lang: document.documentElement.getAttribute("lang"),
  appUrl,
  moduleUrl: appUrl + "m/",   // same as server-side: appUrl + "m/"
  dev: !!globalThis.qino?.dev,
  csrfToken: globalThis.qino?.csrfToken,
};

// server-side: import { getCtx } ... — client-side there is only the one ctx
export function getCtx() { return ctx; }
