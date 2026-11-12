import { createHash } from "node:crypto";

import type { App } from "@qino/qino";

/** Dev helpers */
export function init(app: App, { signal }: { signal: AbortSignal }): void {
  // counts each text t`` looks up (smalltext.count, for "delete unused" in the translate backend), while
  // core.smalltext.counter is on
  const counter = app.settings.core.smalltext.counter;
  app.languages.onUse = (ns, original) => {
    if (!counter()) return;
    const hash = createHash("md5").update(original).digest("hex");
    app.db.exec`UPDATE smalltext SET count = count + 1 WHERE hash = ${hash} AND namespace = ${ns}`.catch(() => {});
  };
  signal.addEventListener("abort", () => app.languages.onUse = undefined);

  // request duration on every response (pages, api, static, dbFile) — visible in the browser devtools network panel
  app.on("response-ready", ({ request, res, time }) => {
    const dur = (performance.now() - time).toFixed(1);
    res.headers.set("Server-Timing", `app;dur=${dur}`);
    console.log(`${request.method} ${new URL(request.url).pathname} ${dur}ms`);
  }, { signal });
}
