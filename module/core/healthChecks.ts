import { hee } from "./lib/util.ts";
import { requestStorage } from "./lib/ctx/Ctx.ts";
import { urlOf } from "./lib/App.ts";

import type { App } from "./lib/App.ts";

export function healthChecks(app: App) {
  const here = () => {
    const ctx = requestStorage.getStore();
    return ctx ? urlOf(ctx) : "";
  };
  const setTo = (url: string) => ({ [`set it to: ${hee(url)}`]: { solve: async () => { await app.settings.core.url(url); } } });

  return { warning: {

    "public address is unknown": async () => {
      if (await app.settings.core.url) return;
      const url = here();
      return { info: "links sent from a job cannot be built without it", solutions: url ? setTo(url) : {} };
    },

    "public address does not answer": async () => {
      const url = String(await app.settings.core.url ?? "");
      if (!url) return; // the check above owns that case
      // its own address, so a redirect or a 404 still proves the app is reachable there
      const reason = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(5000) })
        .then((res) => res.status >= 500 ? `answers ${res.status}` : "", (e) => String(e));
      if (!reason) return;
      const current = here();
      return { info: `${hee(url)} — ${hee(reason)}`, solutions: current && current !== url ? setTo(current) : {} };
    },

  } };
}
