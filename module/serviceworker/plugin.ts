import { Output, sha256b64url } from "@qino/qino";
import type { App, Ctx, Module } from "@qino/qino";

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  let cache: { key: string; script: string; etag: string } | undefined; // per app — a module global would mix tenants

  // Linked parts, asset revisions and mount paths determine the generated import URLs.
  const keyOf = (base: string) => JSON.stringify([base, app.assetRev, partNames(app)]);

  /** The worker is nothing but imports — every behaviour comes from a module's part. */
  const build = async (base: string) => {
    const names = partNames(app);
    if (!names.length) return; // no part, no worker
    const url = `${base}m.${app.assetRev.toString(36)}/`; // same shape as `req.moduleUrl`, which needs a Ctx
    const script = names.map((name) => `import ${JSON.stringify(`${url + name}/pub/sw.js`)};\n`).join("");
    return cache = { key: keyOf(base), script, etag: `W/"${await sha256b64url(script)}"` };
  };

  // Served before routing — the worker needs neither session nor database, and update checks are frequent.
  app.on("request-start", async ({ request, base }) => {
    const path = base + "sw.js";
    if (!request.url.endsWith(path)) return; // this hook sees every request — reject without allocating
    if (request.url.slice(request.url.indexOf("/", 8)) !== path) return; // a mount at "/" must not swallow /page/sw.js
    const worker = cache?.key === keyOf(base) ? cache : await build(base);
    if (!worker) return;
    const fresh = request.headers.get("if-none-match") === worker.etag;
    // "no-cache" stores the worker but revalidates it; the ETag then answers most checks with a 304
    throw new Output(fresh ? undefined : worker.script, {
      status: fresh ? 304 : 200,
      headers: {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "no-cache",
        ETag: worker.etag,
      },
    });
  }, { signal });

  app.on("html-ready", ({ ctx }) => register(ctx), { signal });
}

/** Linked modules shipping a `pub/sw.js` — the file in the manifest is the whole declaration. */
const hasWorkerPart = (mod: Module) => mod.manifest.files?.includes("pub/sw.js");
const partNames = (app: App) => app.modules.linked().filter(hasWorkerPart).map((mod) => mod.name);

// runs on every rendered page
function register(ctx: Ctx): void {
  if (!partNames(ctx.app).length) return;
  ctx.res.html.scripts.add(ctx.req.moduleUrl + "serviceworker/pub/register.js");
}
