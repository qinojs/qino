// Library module without routes or settings. API in ./mod.ts; collects the `authFactors` exports.
// Its table holds secrets of factors without an own table.
import { hee, userFactors } from "@qino/qino";

import type { App } from "@qino/qino";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

export function healthChecks(app: App) {
  return {
    warning: {
      // whoever has their password has the app; two factors are what core.loginTwoFactor asks for
      "superusers without a second factor": async () => {
        const users = await app.db.query`SELECT id, username FROM usr WHERE superuser = ${true} AND active = ${true}`;
        const single = [];
        for (const u of users) if ((await userFactors(app, Number(u.id))).length < 2) single.push(String(u.username || `#${u.id}`));
        if (!single.length) return;
        return { info: `${hee(single.join(", "))}: set up an authenticator app or a passkey` };
      },
    },
  };
}
