import { Output, Redirect, sha256b64url } from "@qino/qino";
import * as identity from "@qino/qino/identity";

import { APPLE_STATUS_BAR_STYLES, DISPLAY_MODES, manifest, ORIENTATIONS } from "./mod.ts";

import type { App, Ctx } from "@qino/qino";

export const settingsSchema = {
  properties: {
    display: {
      type: "string",
      enum: DISPLAY_MODES,
      default: "browser",
      description: "Preferred browser chrome around the installed application.",
    },
    orientation: {
      type: "string",
      enum: ORIENTATIONS,
      default: "any",
      description: "Preferred screen orientation of the installed application.",
    },
    categories: {
      type: "string",
      "x-multiline": true,
      description: "Lower-case application categories, one per line.",
    },
    telephoneDetection: {
      type: "boolean",
      default: true,
      description: "Allow browsers and Skype integrations to detect telephone numbers.",
    },
    appleStatusBarStyle: {
      type: "string",
      enum: APPLE_STATUS_BAR_STYLES,
      description: "Apple standalone-mode status bar style.",
    },
  },
};

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  app.on("route", ({ ctx }) => route(ctx), { signal });
  app.on("html-ready", ({ ctx }) => head(ctx), { signal });
}

async function route(ctx: Ctx): Promise<void> {
  const appPath = ctx.req.appPath;
  if (appPath === "manifest.webmanifest") return serveManifest(ctx);
  if (appPath !== "favicon.ico" && appPath !== "apple-touch-icon.png") return;
  const icon = await (await identity.file(ctx.app, "icon"))?.exists();
  if (!icon) return;
  const size = appPath === "apple-touch-icon.png" ? 180 : 32;
  throw new Redirect(await icon.url({ w: size, h: size, fmt: "png", q: 90 }), 302, { "Cache-Control": "public, max-age=86400" });
}

async function serveManifest(ctx: Ctx): Promise<void> {
  const body = JSON.stringify(await manifest(ctx), null, 2) + "\n";
  const headers = {
    "Content-Type": "application/manifest+json; charset=utf-8",
    "Cache-Control": "no-cache",
    ETag: `W/"${await sha256b64url(body)}"`,
  };
  if (ctx.req.header("if-none-match") === headers.ETag) throw new Output(undefined, { status: 304, headers });
  throw new Output(body, { headers });
}

async function head(ctx: Ctx): Promise<void> {
  const html = ctx.res.html;
  const data = await manifest(ctx);
  const settings = ctx.app.settings.webapp;
  const icon = Array.isArray(data.icons) ? data.icons[0] as Record<string, unknown> | undefined : undefined;
  const iconSrc = String(icon?.src ?? "");

  html.link[ctx.req.appUrl + "manifest.webmanifest"] = { rel: "manifest" };
  if (iconSrc) html.link[iconSrc] = { rel: "icon", ...(icon?.type ? { type: String(icon.type) } : {}) };
  if (data.theme_color) html.meta["theme-color"] = String(data.theme_color);
  const identityIcon = await (await identity.file(ctx.app, "icon"))?.exists();
  if (identityIcon) {
    const src = await identityIcon.url({ w: 180, h: 180, fmt: "png", q: 90 });
    html.link[src] = { rel: "apple-touch-icon" };
  }
  if (data.display && data.display !== "browser") { // needed, checked 2026
    html.meta["apple-mobile-web-app-capable"] = "yes";
    const name = data.short_name as string;
    if (name) html.meta["apple-mobile-web-app-title"] = name;
    const style = String(await settings.appleStatusBarStyle ?? "");
    if (style) html.meta["apple-mobile-web-app-status-bar-style"] = style;
  }
  if (!await settings.telephoneDetection) {
    html.meta["format-detection"] = "telephone=no";
    html.meta.SKYPE_TOOLBAR = "SKYPE_TOOLBAR_PARSER_COMPATIBLE";
  }
}
