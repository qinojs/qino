// Public API of the identity module. The qino-module manifest is in ./plugin.ts.

import type { App, Ctx, DbFile } from "../core/mod.ts";

/** An uploaded brand asset — "logo", "icon" or "font"; undefined while none is set. */
export async function file(app: App, name: string): Promise<DbFile | undefined> {
  const id = Number(await app.db.one`SELECT file_id FROM identity_file WHERE name = ${name}`);
  return id ? await app.dbFiles.file(id) : undefined;
}

/** Settings are free text — keep a value inside the declaration it belongs to. */
const clean = (value: unknown) => String(value ?? "").replace(/[^\w .,#()%-]/g, "");

/** The brand as css defaults: unlayered and ahead of every stylesheet, so layout and site css override it. */
export async function css(ctx: Ctx): Promise<void> {
  const brand = ctx.app.settings.identity.brand;
  const [color, accent, bg, fontFamily] = await Promise.all([brand.primaryColor, brand.accentColor, brand.backgroundColor, brand.fontFamily]);
  const font = await file(ctx.app, "font");
  const family = clean(fontFamily) || clean(font?.name.replace(/\.\w+$/, ""));

  let out = font && family ? `@font-face{font-family:"${family}";src:url("${await font.url()}");font-display:swap}` : "";
  const vars = [
    color && `--color:${clean(color)}`,
    accent && `--accent:${clean(accent)}`,
    bg && `--color-bg:${clean(bg)}`,
    family && `--font-1:"${family}",sans-serif`,
  ].filter(Boolean);
  if (vars.length) out += `html{${vars.join(";")}}`;

  if (out) ctx.res.html.inlineStyles.add(out);
}
