import manifest from "./manifest.json" with { type: "json" };

import type { App } from "@qino/qino";

const { name } = manifest;

export function zzz_init(app: App, { signal }: { signal: AbortSignal }): void {
  app.on("html-ready", ({ ctx }) => {
    const html = ctx.res.html;
    const base = ctx.req.moduleUrl + name + "/pub/";
    const styles = [...html.styles];
    const scripts = [...html.scripts];

    const backendCss = styles.find((s) => s.endsWith("cms.layout.backend/pub/main.css"));
    const uiCss = styles.find((s) => s.endsWith("cms/pub/css/ui.css"));
    const hasFrontend = scripts.some((s) =>
      s.endsWith("cms.frontend/pub/js/init.js") || s.endsWith("cms.frontend/pub/panel/panel.js")
    );

    if (backendCss) {
      // Drop legacy backend & ui.css so u2's classless/more/card/table styles work natively.
      html.styles.delete(backendCss);
      if (uiCss) html.styles.delete(uiCss);
      html.meta["color-scheme"] = "light dark";
      html.styles.add(base + "base.css");
      html.styles.add(base + "backend.css");
    } else if (uiCss) {
      html.styles.add(base + "base.css");
    }

    if (hasFrontend) html.scripts.add(base + "shadow.js");
  }, { signal });
}
