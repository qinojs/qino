import * as identity from "@qino/qino/identity";

import type { Ctx } from "@qino/qino";

export const DISPLAY_MODES = ["browser", "minimal-ui", "standalone", "fullscreen"];
export const ORIENTATIONS = ["any", "natural", "landscape", "portrait", "portrait-primary", "portrait-secondary", "landscape-primary", "landscape-secondary"];
export const APPLE_STATUS_BAR_STYLES = ["", "default", "black", "black-translucent"];

const trim = async (value: unknown): Promise<string> => String(await value ?? "").trim();

/** Build the manifest for this request, then let linked modules extend it. */
export async function manifest(ctx: Ctx): Promise<Record<string, unknown>> {
  const app = ctx.app;
  const settings = app.settings.webapp;
  const brand = app.settings.identity;
  const alternateName = await trim(brand.alternateName) || ctx.req.url.host;
  const name = await trim(brand.name) || alternateName;
  const description = await trim(brand.description);
  const display = await trim(settings.display);
  const orientation = await trim(settings.orientation);
  const themeColor = await trim(brand.brand.primaryColor);
  const backgroundColor = await trim(brand.brand.backgroundColor);
  const categories = [...new Set((await trim(settings.categories))
    .split(/[\r\n,]+/).map((v) => v.trim().toLowerCase()).filter(Boolean))];
  const icon = await (await identity.file(app, "icon"))?.exists();
  const icons = icon ? [{
    src: await icon.url(),
    ...(icon.mime && { type: icon.mime }),
    ...(icon.mime === "image/svg+xml" && { sizes: "any" }),
  }] : undefined;

  const data: Record<string, unknown> = {
    name,
    short_name: alternateName || name,
    ...(description && { description }),
    id: ctx.req.appUrl,
    scope: ctx.req.appUrl,
    start_url: ctx.req.appUrl,
    ...(display && { display }),
    ...(orientation && { orientation }),
    ...(themeColor && { theme_color: themeColor }),
    ...(backgroundColor && { background_color: backgroundColor }),
    ...(categories.length && { categories }),
    ...(icons && { icons }),
  };
  return (await app.fire("webapp:manifest", { ctx, manifest: data })).manifest;
}
