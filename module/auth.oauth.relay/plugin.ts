import { Output, Redirect, unb64url } from "@qino/qino";

import type { App, Ctx } from "@qino/qino";

export const settingsSchema = {
  properties: {
    hosts: {
      type: "string",
      description: "Hosts the relay forwards to, space or comma-separated; \"*.example.com\" covers subdomains.",
    },
  },
};

/** Is `host` in a list like "a.ch *.b.ch"? */
export const allowed = (list: string, host: string): boolean =>
  list.split(/[\s,]+/).filter(Boolean).some((h) => h === host || (h.startsWith("*.") && host.endsWith(h.slice(1))));

/** The app's own callback, carried by auth.oauth as `<random>.<base64url(url)>` in the state. */
function target(state: string) {
  try { return URL.parse(new TextDecoder().decode(unb64url(state.split(".")[1] ?? ""))); } catch { return null; }
}

/** The provider's callback: forward its answer to the app that started the login. A POST (Apple's form_post)
 *  becomes a GET, so the browser sends the app's SameSite=Lax session cookie along. */
export async function relay(ctx: Ctx): Promise<never> {
  const params = new URLSearchParams({ ...ctx.req.query, ...ctx.req.body });
  const url = target(params.get("state") ?? "");
  const hosts = String(await ctx.app.settings["auth.oauth.relay"].hosts ?? "");
  if (url?.protocol !== "https:" || !allowed(hosts, url.hostname)) {
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
