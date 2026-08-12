// Public API of the u2 module. The qino-module manifest is in ./plugin.ts.
// Helpers mirror u2's own layout: elements under `el`, the framework itself flat.

import { u2Root, type App, type Ctx } from "../core/mod.ts";
import * as identity from "../identity/mod.ts";

export * as el from "./lib/el.ts";

const CDN = "https://cdn.jsdelivr.net/gh/u2ui/u2@";

/** Where a u2 release lives: the site's own base (mirror, self-hosted) wins, then the version the
 *  caller pinned — a layout's css is written against one — else the release qino ships with. */
export async function root(app: App, version?: string): Promise<string> {
  const base = String(await app.settings.u2.root ?? "");
  if (base) return base.endsWith("/") ? base : base + "/";
  return version ? `${CDN}${version}/` : u2Root;
}

/** Link u2 files (paths below the root) into the document and allow the origin. `u2/auto.js` is one of
 *  them: it fetches whatever the markup turns out to need, which a layout with a settled design can drop. */
export async function assets(ctx: Ctx, files: string[], version?: string): Promise<void> {
  const base = await root(ctx.app, version);
  for (const directive of ["style-src", "script-src", "connect-src"] as const) ctx.res.csp[directive][base] = true;
  for (const f of files) (f.endsWith(".js") ? ctx.res.html.scripts : ctx.res.html.styles).add(base + f);
}

/** Settings are free text — keep a value inside the declaration it belongs to. */
const clean = (value: unknown) => String(value ?? "").replace(/[^\w .,#()%-]/g, "");

/** The identity brand as u2's variables, for `res.html.inlineStyles`: u2 derives its palette from them. */
export async function identityCss(app: App): Promise<string> {
  const brand = app.settings.identity.brand;
  const [color, accent, bg, fontFamily] = await Promise.all([brand.primaryColor, brand.accentColor, brand.backgroundColor, brand.fontFamily]);
  const font = await identity.file(app, "font");
  const family = clean(fontFamily) || clean(font?.name.replace(/\.\w+$/, ""));

  let out = font && family ? `@font-face{font-family:"${family}";src:url("${await font.url()}");font-display:swap}` : "";
  const vars = [
    color && `--color:${clean(color)}`,
    accent && `--accent:${clean(accent)}`,
    bg && `--color-bg:${clean(bg)}`,
    family && `--font-1:"${family}",sans-serif`,
  ].filter(Boolean);
  if (vars.length) out += `html{${vars.join(";")}}`;
  return out;
}
