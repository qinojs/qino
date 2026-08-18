import { requestStorage } from "@qino/qino";

import { keyed, PATH, sign, STEM } from "./lib/code.ts";

import type { App } from "@qino/qino";

/**
 * A short link for `url`. The same target gives the same link back, and a later `expires` only
 * ever lengthens its life. Tell recipients apart with a segment of your own —
 * `${await shorten(app, url)}/${deliveryId}` reaches the `shorturl:hit` event and is stored nowhere.
 */
export async function shorten(app: App, url: string, opt: { expires?: number } = {}): Promise<string> {
  const root = await base(app);
  const target = new URL(url, root).href;
  const table = app.db.table("shorturl");
  // a code taken by another target gives way to the next round, which the link finds again the
  // same way when it is made once more — so codes stay one length instead of growing
  for (let round = 0; round < 8; round++) {
    const code = await sign(app, (await keyed(app, "url", `${target}\n${round}`)).slice(0, STEM));
    const known = await app.db.row`SELECT url, expires FROM shorturl WHERE code = ${code}`;
    if (known && known.url !== target) continue;
    if (!known) {
      await table.insert({
        code,
        url: target,
        hits: 0,
        expires: opt.expires ?? null,
        log_id: await requestStorage.getStore()?.logId ?? null,
      });
    } else if (known.expires != null && (opt.expires === undefined || Number(known.expires) < opt.expires)) {
      // never shorten a life, only lengthen it — no expiry is the longest
      await table.update(code, { expires: opt.expires ?? null });
    }
    return `${root}${PATH}/${code}`;
  }
  throw new Error(`shorturl: no free code for ${target}`);
}

async function base(app: App) {
  const stored = String(await app.settings.shorturl.base ?? "");
  if (stored) return stored.replace(/\/?$/, "/");
  const ctx = requestStorage.getStore();
  if (!ctx) throw new Error("shorturl: set shorturl.base to shorten outside a request");
  return new URL(ctx.req.appUrl, ctx.req.url.href).href;
}
