// Public API of the u2 module. The qino-module manifest is in ./plugin.ts.
// Helpers mirror u2's own layout: elements under `el`, the framework itself flat.
import { u2Root } from "@qino/qino";
import * as identity from "@qino/qino/identity";

import type { App, Ctx } from "@qino/qino";

export * as el from "./lib/el.ts";

// Two u2 releases live on a page and never meet:
//
//   `@qino/u2/` in the import map is the one qino's own modules are written against — the panel, the
//   editor, the backend. It is the pin in deno.json, and a site does not get to move it.
//
//   A layout asks for its own with `assets(ctx, files, "1.4.6")`. That one is written into the page as
//   a finished url and never touches the import map, so the two versions cannot collide.
//
// Both come from the same host: cutting the version off the pin keeps its spelling — jsdelivr
// `@1.5.16`, gcdn `@v1.5.16`. Qino names the cdn, the caller names the version on it.
const CDN = u2Root.replace(/(@v?)[\d.]+\/$/, "$1");

/** Where a u2 release lives: the version the caller pinned, else the one qino ships with. */
export const root = (version?: string): string => version ? `${CDN}${version}/` : u2Root;

// What an element fetches on its own once it upgrades — its dependency, declared where it is known.
// Paths end in "/", so a version bump inside u2 needs no change here.
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

/** Link u2 files (paths below the root) into the document and allow the origin. `u2/auto.js` is one of
 *  them: it fetches whatever the markup turns out to need, which a layout with a settled design can drop. */
export function assets(ctx: Ctx, files: string[], version?: string): void {
  const base = root(version);
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
