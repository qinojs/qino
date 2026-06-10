// Client-Gegenstück zum serverseitigen `app`/`ctx`.
//
//   import { getCtx } from "./qino.js";
//   const ctx = getCtx();
//
//   await ctx.app.apt.core.user.me.get();   // RPC      (wie serverseitig ctx.app.apt.…)
//   await ctx.app.t`Hallo ${name}`;         // übersetzung (wie serverseitig app.t`…`)
//   await ctx.settings.foo.bar;             // user/session settings (wie ctx.settings)
//   await ctx.settings.foo.bar.set("x");
//   ctx.lang / ctx.token / ctx.appURL / ctx.sysURL / ctx.dev
//
// ctx.settings == serverseitig ctx.settings (NICHT app.settings — die sind server-only).
// läuft über den bestehenden apt-endpoint  core/ctx-settings/:path*  (Access.USER).

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
      // wir bekommen den ganzen teilbaum → werte direkt cachen, kein nachladen.
      // { local: true } = nicht via writer zurückschreiben (kam ja vom server).
      for (const k in value) this.item(k).set(value[k], { local: true });
      return; // node ist objekt
    }
    return value; // blatt-wert
  };

  writer = async (value) => {
    await apt.core["ctx-settings"](this.path).put({ value });
  };
}

const appURL = globalThis.qino?.appURL ?? "/";

export const ctx = {
  app: { apt, t },         // serverseitig: ctx.app → app.apt / app.t
  lang: document.documentElement.getAttribute("lang"),
  appURL,
  sysURL: appURL + "m/",   // wie serverseitig: appURL + "m/"
  settings: new CtxSetting().proxy,
  dev: !!globalThis.qino?.dev,
  token: globalThis.qino?.token,
};

// serverseitig: import { getCtx } ... — clientseitig gibt es nur den einen ctx
export function getCtx() { console.log(Error().stack); return ctx; }

export { t };
