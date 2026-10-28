import { createHmac } from "node:crypto";
import { hostAllowed, Output, Redirect, safeEqual, unb64url } from "@qino/qino";

import type { App, Ctx } from "@qino/qino";

export const settingsSchema = {
  properties: {
    hosts: {
      type: "string",
      "x-multiline": true,
      description: "Hosts the relay forwards to, one per line; \"*.example.com\" covers subdomains.",
    },
  },
};

/** Signed by auth.oauth with one of these client secrets? Same signature as there. */
export const signed = (keys: string[], data: string, sig: string): boolean =>
  !!sig && keys.some((k) => safeEqual(sig, createHmac("sha256", k.trim()).update(data).digest("base64url").slice(0, 22)));

/** The client secrets of this app's own providers: whoever shares one may use the relay. */
const secrets = async (app: App): Promise<string[]> =>
  (await app.db.query`SELECT client_secret FROM oauth_provider WHERE client_secret <> ''`)
    .map((r) => String(r.client_secret));

/** The app's own callback, carried by auth.oauth as `<random>.<base64url(url)>[.<signature>]` in the state. */
function target(part: string) {
  try { return URL.parse(new TextDecoder().decode(unb64url(part))); } catch { return null; }
}

/** The provider's callback: forward its answer to the app that started the login. A POST (Apple's form_post)
 *  becomes a GET, so the browser sends the app's SameSite=Lax session cookie along.
 *  Only to auth.oauth callbacks: any other page of an allowed host could leak the code (Referer, redirects). */
export async function relay(ctx: Ctx): Promise<never> {
  const params = new URLSearchParams({ ...ctx.req.query, ...ctx.req.body });
  const [rnd = "", part = "", sig = ""] = (params.get("state") ?? "").split(".");
  const url = part ? target(part) : null;
  const ok = url?.protocol === "https:" && /\/oauth\/callback\/[^/]+$/.test(url.pathname) && !url.search && !url.hash;
  if (!ok || !(signed(await secrets(ctx.app), `${rnd}.${part}`, sig) ||
    hostAllowed(String(await ctx.app.settings["auth.oauth.relay"].hosts ?? ""), url.hostname))) {
    throw new Output("oauth relay target not allowed", { status: 400 });
  }
  for (const [k, v] of params) url.searchParams.set(k, v);
  throw new Redirect(url.href, 303);
}

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  app.on("route", ({ ctx }) => {
    if (ctx.req.appPath === "oauth/relay") return relay(ctx);
  }, { signal });
}
