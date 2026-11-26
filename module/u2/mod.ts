// Helpers mirror u2's own layout: elements under `el`, the framework itself flat.
import { fs, html, Output, u2Root } from "@qino/qino";
import * as identity from "@qino/qino/identity";

import { fontAxes } from "./lib/fontAxes.ts";

import type { App, Ctx, DbFile, HtmlString } from "@qino/qino";

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

// per app and font file (its content hash): the descriptors once read, "" until then
const known = new WeakMap<App, Map<string, string>>();

/** A variable font's weight and width ranges for its `@font-face`, else the browser draws only its
 *  default instance. Read in the background, once per file: no request waits for the file. */
function ranges(app: App, font: DbFile): string {
  const files = known.getOrInsertComputed(app, () => new Map());
  const hit = files.get(font.path);
  if (hit !== undefined) return hit;
  files.set(font.path, "");
  fs.bytes(font.path).then((bytes) => {
    const { wght, wdth } = fontAxes(bytes);
    files.set(font.path, (wght ? `font-weight:${wght.join(" ")};` : "") + (wdth ? `font-stretch:${wdth.join("% ")}%;` : ""));
  }).catch(() => {});
  return "";
}

/** The identity brand as u2's variables, for `res.html.inlineStyles`: u2 derives its palette from them. */
export async function identityCss(app: App): Promise<string> {
  const brand = app.settings.identity.brand;
  const [color, accent, bg, fontFamily, font] = await Promise.all([
    brand.primaryColor, brand.accentColor, brand.backgroundColor, brand.fontFamily, identity.file(app, "font"),
  ]);
  const family = clean(fontFamily) || clean(font?.name.replace(/\.\w+$/, ""));

  let out = font && family ? `@font-face{font-family:"${family}";src:url("${await font.url()}");${ranges(app, font)}font-display:swap}` : "";
  const vars = [
    color && `--color:${clean(color)}`,
    accent && `--accent:${clean(accent)}`,
    bg && `--color-bg:${clean(bg)}`,
    family && `--font-1:"${family}",sans-serif`,
  ].filter(Boolean);
  if (vars.length) out += `html{${vars.join(";")}}`;
  return out;
}

const PAGE_CSS = "body{display:grid;place-items:center;min-height:100vh;margin:0;padding:1rem;box-sizing:border-box}"
  + "body>main{width:min(100%,28rem);padding:2rem;border-radius:1rem;box-shadow:0 .2rem 1.5rem #0002}"
  + "body>main>img{display:block;height:3rem;width:auto;margin-bottom:1.5rem}";

/**
 * A page of its own for a system view (unsubscribe, sign-in), ending the route. No layout and no
 * site code — only u2's styles in the site's identity, so a flaw in a layout cannot reach it; no
 * referrer, so a token in the url stays here.
 */
export async function page(ctx: Ctx, title: string, body: HtmlString, { status = 200 }: { status?: number } = {}): Promise<never> {
  const app = ctx.app;
  // the look is a nicety: without identity the page still stands
  const [css, logo] = await Promise.all([
    identityCss(app).catch(() => ""),
    identity.file(app, "logo").then((file) => file?.url({ h: 96 })).catch(() => undefined),
  ]);
  assets(ctx, ["css/norm/norm.css", "css/base/base.css", "css/classless/variables.css", "css/classless/classless.css"]);
  const doc = ctx.res.html;
  doc.inlineStyles.add(css + PAGE_CSS);
  doc.title = title;
  doc.meta.robots = "noindex, nofollow";
  ctx.res.headers.set("Referrer-Policy", "no-referrer");
  doc.content = (await html.async`<main>${logo ? html`<img src="${logo}" alt="">` : ""}<h1>${title}</h1>${body}</main>`).html;
  ctx.res.status = status;
  throw new Output();
}
