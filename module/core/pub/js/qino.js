// Client-side counterpart of the server-side `app`/`ctx`.
//
//   import { getCtx } from "./qino.js";
//   const ctx = getCtx();
//
//   await ctx.app.api.core.user.me.get();   // RPC         (like server-side ctx.app.api.…)
//   await ctx.app.t`Hallo ${name}`;         // translation (like server-side app.t`…`)
//   await ctx.settings.foo.bar;             // user/session settings (like ctx.settings)
//   await ctx.settings.foo.bar.set("x");
//   ctx.lang / ctx.csrfToken / ctx.appUrl / ctx.moduleUrl / ctx.dev
//
// ctx.settings == server-side ctx.settings (NOT app.settings — those are server-only).
// Backed by the existing api endpoint  core/ctx-settings/:path*  (Access.USER).
import { Item } from "@qino/item/item.js";

import { ApiClient } from "./ApiClient.js";
import { t } from "./t.mjs";

function defaultBase() {
  const el = document.querySelector('#qino-data');
  let appUrl = globalThis.qino?.appUrl;
  if (!appUrl && el?.textContent) try { appUrl = JSON.parse(el.textContent)?.qino?.appUrl; } catch { /* not json */ }
  return new URL("api/", location.origin + (appUrl ?? "/"));
}

export const api = new ApiClient(defaultBase());
export { ApiError } from "./ApiClient.js";

class CtxSetting extends Item {

  reader = async () => {
    const value = await api.core["ctx-settings"](this.path).get();
    if (value && typeof value === "object") {
      // we get the whole subtree → cache the values directly, no re-fetch.
      // { local: true } = don't write back via writer (it just came from the server).
      for (const k in value) this.item(k).set(value[k], { local: true });
      return; // node is an object
    }
    return value; // leaf value
  };

  writer = async (value) => {
    await api.core["ctx-settings"](this.path).put({ value });
  };
}

const appUrl = globalThis.qino?.appUrl ?? "/";

export const ctx = {
  app: { api, t },         // server-side: ctx.app → app.api / app.t
  lang: document.documentElement.getAttribute("lang"),
  appUrl,
  moduleUrl: appUrl + "m/",   // same as server-side: appUrl + "m/"
  settings: new CtxSetting().proxy,
  dev: !!globalThis.qino?.dev,
  csrfToken: globalThis.qino?.csrfToken,
};

// server-side: import { getCtx } ... — client-side there is only the one ctx
export function getCtx() { return ctx; }

export { t };
export { hee } from "./util/hee.mjs";
