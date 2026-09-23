import { requestStorage } from "@qino/qino";

import { PATH, sign, stemOf } from "./lib/code.ts";

import type { App } from "@qino/qino";

/** Path segment the links live under — `${await app.url()}${PATH}/${code}` is a link. */
export { PATH } from "./lib/code.ts";

/**
 * Short link for `url`. The same target returns the same link; a later `expires` only extends it.
 * To tell recipients apart, append a segment: `${await shorten(app, url)}/${deliveryId}` reaches
 * the `shorturl:hit` event and is not stored.
 */
export async function shorten(app: App, url: string, opt: { expires?: number } = {}): Promise<string> {
  const root = await app.url();
  const target = new URL(url, root).href;
  const prefix = `${root}${PATH}/`;
  const localCode = target.startsWith(prefix) ? target.slice(prefix.length) : "";
  if (localCode && !localCode.includes("/") && await app.db.one`SELECT code FROM shorturl WHERE code = ${localCode}`) {
    return target;
  }
  const table = app.db.table("shorturl");
  // if the code is taken by another target, try the next round (found again the same way later),
  // so codes keep their length
  for (let round = 0; round < 8; round++) {
    const code = await sign(app, await stemOf(app, `${target}\n${round}`));
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
    return `${prefix}${code}`;
  }
  throw new Error(`shorturl: no free code for ${target}`);
}
