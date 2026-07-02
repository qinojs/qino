// Client-side counterpart of the server-side `app`/`ctx`.
//
//   import { getCtx } from "./qino.js";
//   const ctx = getCtx();
//
//   await ctx.app.apt.core.user.me.get();   // RPC         (like server-side ctx.app.apt.…)
//   await ctx.app.t`Hallo ${name}`;         // translation (like server-side app.t`…`)
//   await ctx.settings.foo.bar;             // user/session settings (like ctx.settings)
//   await ctx.settings.foo.bar.set("x");
//   ctx.lang / ctx.token / ctx.appURL / ctx.sysURL / ctx.dev
//
// ctx.settings == server-side ctx.settings (NOT app.settings — those are server-only).
// Backed by the existing apt endpoint  core/ctx-settings/:path*  (Access.USER).

import { Item } from "@qino/item/item.js";
import { AptClient } from "./AptClient.js";
import { t } from "./t.mjs";

function defaultBase() {
  const el = document.querySelector('script[type="json/c1"]');
  let appURL = globalThis.qino?.appURL;
  if (!appURL && el?.textContent) try { appURL = JSON.parse(el.textContent)?.qino?.appURL; } catch { /* not json */ }
  return new URL("api/", location.origin + (appURL ?? "/"));
}

export const apt = new AptClient(defaultBase());

class CtxSetting extends Item {

  reader = async () => {
    const value = await apt.core["ctx-settings"](this.path).get();
    if (value && typeof value === "object") {
      // we get the whole subtree → cache the values directly, no re-fetch.
      // { local: true } = don't write back via writer (it just came from the server).
      for (const k in value) this.item(k).set(value[k], { local: true });
      return; // node is an object
    }
    return value; // leaf value
  };

  writer = async (value) => {
    await apt.core["ctx-settings"](this.path).put({ value });
  };
}

const appURL = globalThis.qino?.appURL ?? "/";

export const ctx = {
  app: { apt, t },         // server-side: ctx.app → app.apt / app.t
  lang: document.documentElement.getAttribute("lang"),
  appURL,
  sysURL: appURL + "m/",   // same as server-side: appURL + "m/"
  settings: new CtxSetting().proxy,
  dev: !!globalThis.qino?.dev,
  token: globalThis.qino?.token,
};

// server-side: import { getCtx } ... — client-side there is only the one ctx
export function getCtx() { console.log(Error().stack); return ctx; }

export { t };
