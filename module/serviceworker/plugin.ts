import { Output, sha256b64url } from "@qino/qino";
import type { App, Ctx, Module } from "@qino/qino";

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  let cache: { key: string; script: string; etag: string } | undefined; // per app — a module global would mix tenants

  // linking/unlinking a part is the only thing that changes the worker
  const fresh = () => cache?.key === partNames(app).join() ? cache : undefined;

  // answers revalidations before routing, the cheapest point in the pipeline
  app.on("request-start", ({ request, base }) => {
    if (!request.url.endsWith(base + "sw.js")) return;
    const hit = fresh();
    if (hit && request.headers.get("if-none-match") === hit.etag) {
      throw new Output(undefined, { status: 304, headers: { ETag: hit.etag } });
    }
  }, { signal });

  /** The worker is nothing but imports — every behaviour comes from a module's part. */
  const build = async (ctx: Ctx) => {
    const names = partNames(app);
    if (!names.length) return; // no part, no worker
    const script = names.map((name) => `import ${JSON.stringify(`${ctx.req.moduleUrl + name}/pub/sw.js`)};\n`).join("");
    return cache = { key: names.join(), script, etag: `W/"${await sha256b64url(script)}"` };
  };

  async function serve(ctx: Ctx): Promise<void> {
    const worker = fresh() ?? await build(ctx);
    if (!worker) return;
    // "no-cache" stores the worker but revalidates it; the ETag then answers most checks with a 304
    const headers = {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-cache",
      ETag: worker.etag,
    };
    if (ctx.req.header("if-none-match") === worker.etag) throw new Output(undefined, { status: 304, headers });
    throw new Output(worker.script, { headers });
  }

  app.on("route", ({ ctx }) => ctx.req.appPath === "sw.js" ? serve(ctx) : undefined, { signal });
  app.on("html-ready", ({ ctx }) => register(ctx), { signal });
}

/** Linked modules shipping a `pub/sw.js` — the file in the manifest is the whole declaration. */
const hasWorkerPart = (mod: Module) => mod.manifest.files?.includes("pub/sw.js");
const partNames = (app: App) => app.modules.linked().filter(hasWorkerPart).map((mod) => mod.name);

// runs on every rendered page
function register(ctx: Ctx): void {
  if (!ctx.app.modules.linked().some(hasWorkerPart)) return;
  ctx.res.html.scripts.add(ctx.req.moduleUrl + "serviceworker/pub/register.js");
}
