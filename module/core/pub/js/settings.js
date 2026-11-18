// Client for the current visitor's settings, via the api endpoint
//   core/ctx-settings/:path*  (Access.USER)
//
//   await settings.foo.bar;   // read
//   settings.foo.bar("x");    // write
//
// A separate module, not part of `ctx`: in the browser there is one visitor per tab. It also keeps
// item.js (core's largest browser dependency) out of pages that only need `api` or `t`.
//
// `@qino/item-cdn/`, not `@qino/item/`: `deno publish` rewrites pub/ specifiers by deno.json too, and
// `@qino/item/` would become a `jsr:` url no browser can load. Versions are in deno.json.
import { Item, item } from "@qino/item-cdn/item.js";
export { item }; // for those who need the factory

import { api } from "./api.js";

class CtxSetting extends Item {

  reader = async () => {
    const value = await api.core["ctx-settings"](this.path).get();
    if (value && typeof value === "object") {
      // the whole subtree arrives → cache it, no re-fetch.
      // { local: true } = don't write back (it came from the server).
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
