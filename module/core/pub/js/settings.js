// Client for the user/session settings of the current visitor, backed by the api endpoint
//   core/ctx-settings/:path*  (Access.USER)
//
//   await settings.foo.bar;   // read
//   settings.foo.bar("x");    // write
//
// Its own module, not a field on `ctx`: the server-side `ctx.settings` is request state, here there
// is one visitor for the lifetime of the tab. It also keeps item.js — the heaviest thing core ships
// to the browser — out of every page that only wants `api` or `t`.
//
// Absolute on purpose: a bare specifier is rewritten to a `jsr:` url when this package is published,
// and no browser can load that. The static import needs a literal, so the url stands twice — a test
// keeps both in step with the pin in deno.json.
import { Item } from "https://cdn.jsdelivr.net/gh/nuxodin/item.js@v0.6.11/item.js";
export const ITEM_ROOT = "https://cdn.jsdelivr.net/gh/nuxodin/item.js@v0.6.11/";

import { api } from "./api.js";

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

export const settings = new CtxSetting().proxy;
