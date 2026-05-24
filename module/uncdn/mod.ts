import { OutputDoneError } from "../core/lib/util.ts";
import { typeByExtension } from "../../deps.ts";
import type { App } from "../core/server.ts";
import type { RequestContext } from "../core/lib/RequestContext.ts";
import type { HtmlBuilder } from "../core/lib/HtmlBuilder.ts";

export const name = "uncdn";

export const settingsSchema = {
  properties: {
    fetchPolicy: {
      type: "string",
      enum: ["auto", "superuser", "all", "none"],
      description: "Who may trigger fetching+caching of new external files via the proxy. 'auto' = fetch in dev mode, serve cache-only in production; 'superuser' = only superusers; 'all' = anyone; 'none' = only already-cached files are served.",
    },
  },
};

const PROXY_PREFIX = "uncdn/";
const CACHE_SUBDIR = "cache/uncdn/";

function urlToPath(cacheDir: string, url: string): string {
  const u = new URL(url);
  return cacheDir + u.hostname + u.pathname;
}

function mimeForPath(filePath: string): string {
  const ext = filePath.split(".").pop() ?? "";
  return typeByExtension(ext) ?? "application/octet-stream";
}

function serveResponse(ctx: RequestContext, mime: string, data: Uint8Array): never {
  ctx.responseHeaders.set("Content-Type", mime);
  ctx.responseHeaders.set("Cache-Control", "public, max-age=31536000, immutable");
  ctx.responseBody = data as never;
  throw new OutputDoneError();
}

async function serveCached(filePath: string, ctx: RequestContext): Promise<void> {
  try {
    serveResponse(ctx, mimeForPath(filePath), await Deno.readFile(filePath));
  } catch (e) {
    if (e instanceof OutputDoneError) throw e;
    // file not in cache yet
  }
}

async function fetchAndCache(url: string, filePath: string, ctx: RequestContext): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  const data = new Uint8Array(await res.arrayBuffer());
  await Deno.mkdir(filePath.replace(/\/[^/]+$/, ""), { recursive: true });
  await Deno.writeFile(filePath, data);
  serveResponse(ctx, mimeForPath(filePath), data);
}

export function init(app: App): void {
  const cacheDir = app.appPATH + CACHE_SUBDIR;

  app.on("action", async e => {
    const ctx = e.ctx as RequestContext;
    if (!ctx.appRequestUri.startsWith(PROXY_PREFIX)) return;
    const rest = ctx.appRequestUri.slice(PROXY_PREFIX.length);
    if (!rest) return;

    const url = "https://" + rest;
    const filePath = urlToPath(cacheDir, url);

    await serveCached(filePath, ctx); // throws OutputDoneError if found

    const fetchPolicy = String(await ctx.app.settings.uncdn.fetchPolicy ?? "auto");

    const denied =
      fetchPolicy === "none" ? "fetchPolicy=none" :
      fetchPolicy === "auto" && !ctx.dev ? "fetchPolicy=dev but not in dev mode" :
      fetchPolicy === "superuser" && !await ctx.user?.get?.("superuser") ? "fetchPolicy=superuser but no superuser session" :
      null;
    if (denied) {
      console.warn(`[uncdn] ${denied}, not fetching: ${url}`);
      ctx.responseStatus = 404;
      ctx.responseBody = "Not cached";
      throw new OutputDoneError();
    }

    await fetchAndCache(url, filePath, ctx);
  });

  app.on("html-ready", e => {
    const ctx = e.ctx as RequestContext;
    if (!ctx.html) return;
    rewriteHtml(ctx.html, ctx.appURL);
  });
}

export function rewriteHtml(html: HtmlBuilder, appURL: string): void {
  const rewrite = (files: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    for (const [url, val] of Object.entries(files)) {
      if (url.startsWith("https://") || url.startsWith("http://")) {
        result[appURL + PROXY_PREFIX + url.replace(/^https?:\/\//, "")] = val;
      } else {
        result[url] = val;
      }
    }
    return result;
  };
  html.jsFiles  = rewrite(html.jsFiles);
  html.jsms     = rewrite(html.jsms);
  html.cssFiles = rewrite(html.cssFiles);
}
