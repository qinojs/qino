// Helpers mirror u2's own layout: elements under `el`, the framework itself flat.
import { u2Root } from "@qino/qino";
import * as identity from "@qino/qino/identity";

import type { App, Ctx } from "@qino/qino";

export * as el from "./lib/el.ts";

// Two u2 releases live on a page, each under its own import-map name:
//
//   `@qino/u2/` is the one qino's own modules are written against — the panel, the editor, the
//   backend. It is the pin in deno.json, and a site does not get to move it.
//
//   `@u2/` is the page's: a layout sets it with `pin(ctx, "1.6.0")`, else it is qino's. Contents ask
//   for files by that name only, so they follow whatever the layout pinned.
//
const CDN = u2Root.replace(/(@v?)[\d.]+\/$/, "$1");

/** Where a u2 release lives: the version the caller pinned, else the one qino ships with. */
export const root = (version?: string): string => version ? `${CDN}${version}/` : u2Root;

// What an element loads itself after upgrading. Paths end in "/", so u2 version bumps need no change.
const OWN: Record<string, string[]> = {
  code: ["https://cdn.jsdelivr.net/gh/highlightjs/"], // u2-code highlights with highlight.js
};

/** Allow what these u2 elements load themselves: `u2.elements(ctx, "code")` on a page showing one. */
export function elements(ctx: Ctx, ...names: string[]): void {
  for (const name of names) {
    for (const src of OWN[name] ?? []) {
      ctx.res.csp["script-src"][src] = true;
      ctx.res.csp["style-src"][src] = true;
    }
  }
}

const use = (ctx: Ctx, base: string) => {
  ctx.res.html.importMap.set("@u2/", base);
  for (const directive of ["style-src", "script-src", "connect-src"] as const) ctx.res.csp[directive][base] = true;
};

/** The page's u2 release: what `@u2/` points to, for the layout's files and its contents'. */
export const pin = (ctx: Ctx, version: string): void => use(ctx, root(version));

/** Link u2 files (paths below the root) from the page's release. `u2/auto.js` loads whatever the
 *  markup needs; a finished layout can drop it. */
export function assets(ctx: Ctx, files: string[]): void {
  if (!ctx.res.html.importMap.has("@u2/")) use(ctx, u2Root);
  for (const f of files) (f.endsWith(".js") ? ctx.res.html.scripts : ctx.res.html.styles).add("@u2/" + f);
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
