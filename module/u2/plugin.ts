import { u2Root, type App } from "@qino/qino";
import { root } from "./mod.ts";

export const settingsSchema = {
  properties: {
    root: { type: "string", format: "uri", description: "Base url of the u2 release this site uses. Empty = the version qino ships with." },
  },
};

export function init(app: App, { signal }: { signal: AbortSignal }) {
  // The browser resolves `@qino/u2/…` through core's map, which knows core's pin — a site on another release repoints it here.
  app.on("html-ready", async ({ ctx }) => {
    const base = await root(app);
    if (base === u2Root) return;
    ctx.res.html.importMap.set("@qino/u2/", base);
    ctx.res.csp["script-src"][base] = true;
    ctx.res.csp["style-src"][base] = true;
  }, { signal });
}
