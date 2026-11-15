import * as identity from "@qino/qino/identity";

import type { Ctx } from "@qino/qino";

export const DISPLAY_MODES = ["browser", "minimal-ui", "standalone", "fullscreen"];
export const ORIENTATIONS = ["any", "natural", "landscape", "portrait", "portrait-primary", "portrait-secondary", "landscape-primary", "landscape-secondary"];
export const APPLE_STATUS_BAR_STYLES = ["", "default", "black", "black-translucent"];

const trim = async (value: unknown) => String(await value ?? "").trim();

/** Unique lower-case categories from a line- or comma-separated list. */
export const categoriesOf = (value: string): string[] =>
  [...new Set(value.split(/[\r\n,]+/).map((v) => v.trim().toLowerCase()).filter(Boolean))];

/** Build the manifest for this request, then let linked modules extend it. */
export async function manifest(ctx: Ctx): Promise<Record<string, unknown>> {
  const app = ctx.app;
  const settings = app.settings.webapp;
  const brand = app.settings.identity;
  const [alternate, brandName, description, display, orientation, themeColor, backgroundColor, categoryList, icon] = await Promise.all([
    trim(brand.alternateName), trim(brand.name), trim(brand.description), trim(settings.display), trim(settings.orientation),
    trim(brand.brand.primaryColor), trim(brand.brand.backgroundColor), trim(settings.categories),
    identity.file(app, "icon").then((file) => file?.exists()),
  ]);
  const alternateName = alternate || ctx.req.url.host;
  const name = brandName || alternateName;
  const categories = categoriesOf(categoryList);
  const icons = icon ? [{
    src: await icon.url({ q: 90 }),
    ...(icon.mime && { type: icon.mime }),
    ...(icon.mime === "image/svg+xml" && { sizes: "any" }),
  }] : undefined;

  const data: Record<string, unknown> = {
    name,
    short_name: alternateName,
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
